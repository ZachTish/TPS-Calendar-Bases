import { App, TFile, normalizePath, Notice, TFolder } from "obsidian";
import * as logger from "../logger";
import { ExternalCalendarService, ExternalCalendarEvent } from "../external-calendar-service";
import { createMeetingNoteFromExternalEvent } from "../external-event-modal";
import { formatDateTimeForFrontmatter } from "../utils";

export interface AutoCreateServiceConfig {
    autoCreateMeetingNotes: boolean;
    meetingNoteFolder: string;
    meetingNoteTemplate: string;
    autoCreateDailyNote: boolean;
    startProperty: string;
    endProperty: string;
    useEndDuration: boolean;
    dateFormat?: string;
    syncOnEventDelete: 'delete' | 'archive' | 'nothing';
    archiveFolder: string;
    canceledStatusValue: string | null;
}

interface VaultNoteIndex {
    file: TFile;
    googleEventId: string;
    uid: string;
    startDate: Date | null;
}

export class AutoCreateService {
    app: App;
    config: AutoCreateServiceConfig;
    private isSyncing = false;
    private lastVaultChangeTimestamp: number;
    private readonly VAULT_IDLE_THRESHOLD_MS = 5000;
    private readonly VAULT_START_DELAY_MS = 1000;
    private readonly VAULT_MAX_WAIT_MS = 60000;

    constructor(app: App) {
        this.app = app;
        this.config = {
            autoCreateMeetingNotes: false,
            meetingNoteFolder: "",
            meetingNoteTemplate: "",
            autoCreateDailyNote: false,
            startProperty: "date",
            endProperty: "end",
            useEndDuration: false,
            syncOnEventDelete: 'nothing',
            archiveFolder: "",
            canceledStatusValue: null,
        };
        this.lastVaultChangeTimestamp = Date.now() - this.VAULT_IDLE_THRESHOLD_MS * 2;
        const updateTimestamp = () => {
            this.lastVaultChangeTimestamp = Date.now();
        };
        this.app.vault.on("modify", updateTimestamp);
        this.app.vault.on("create", updateTimestamp);
        this.app.vault.on("delete", updateTimestamp);
        this.app.vault.on("rename", updateTimestamp);
    }

    updateConfig(config: Partial<AutoCreateServiceConfig>) {
        this.config = { ...this.config, ...config };
    }

    async createTodaysDailyNote(folder: string = "", templatePath: string = "", dateFormat: string = "YYYY-MM-DD"): Promise<TFile | null> {
        return null; 
    }

    /**
     * Main Sync Entry Point
     */
    async checkAndCreateMeetingNotes(
        externalCalendarService: ExternalCalendarService,
        urls: string[],
        externalCalendarFilter: string,
        calendarTags: Record<string, string>,
        hiddenEvents: string[]
    ) {
        if (this.isSyncing) {
            logger.log('[AutoCreateService] Sync already in progress, skipping');
            return;
        }

        if (!this.config.autoCreateMeetingNotes) {
            logger.log('[AutoCreateService] Auto-create disabled');
            return;
        }

        await this.waitForVaultToSettle();

        this.isSyncing = true;
        logger.log('[AutoCreateService] Starting robust sync...');

        try {
            // 1. Define Sync Window
            const start = new Date();
            start.setDate(start.getDate() - 7);
            const end = new Date();
            end.setDate(end.getDate() + 14);

            // 2. Fetch All Remote Events
            const remoteEvents = await this.fetchAllRemoteEvents(externalCalendarService, urls, start, end, externalCalendarFilter);
            
            // 3. Index Local Notes
            const vaultIndex = this.buildVaultIndex();

            // 4. Reconcile
            let created = 0;
            let updated = 0;
            let deleted = 0;

            const matchedFiles = new Set<string>();

            for (const event of remoteEvents) {
                // Skip hidden events logic REMOVED.
                // We must process hidden events if a note ALREADY exists for them, to update/delete it.
                // We only skip creation if hidden.
                
                const result = await this.processEvent(event, vaultIndex, calendarTags[event.sourceUrl || ""], hiddenEvents);
                if (result.action === 'created') created++;
                if (result.action === 'updated') updated++;
                if (result.action === 'deleted') deleted++;
                
                if (result.file) {
                    matchedFiles.add(result.file.path);
                }
            }

            // 5. Handle Orphans (Events deleted from calendar but note exists)
            // We only delete if the note falls within our sync window (to avoid deleting ancient history)
            for (const note of vaultIndex) {
                if (matchedFiles.has(note.file.path)) continue;

                // Check if note date is within window
                if (note.startDate && note.startDate >= start && note.startDate <= end) {
                    // This note has a googleEventId but no corresponding event was found in the fetch.
                    // This implies the event was deleted remotely.
                    // logger.log(`[AutoCreateService] Detected orphan note: ${note.file.basename}`);
                    await this.deleteOrArchive(note.file);
                    deleted++;
                }
            }

            if (created + updated + deleted > 0) {
                new Notice(`Calendar Sync: ${created} created, ${updated} updated, ${deleted} deleted`);
            } else {
                logger.log('[AutoCreateService] No changes.');
            }

        } catch (e) {
            logger.error('[AutoCreateService] Sync failed:', e);
        } finally {
            this.isSyncing = false;
        }
    }

    private async waitForVaultToSettle(): Promise<void> {
        const startTime = Date.now();
        let hadRecentChanges = false;
        while (true) {
            const now = Date.now();
            const sinceLastChange = now - this.lastVaultChangeTimestamp;
            const changeWindowStart = startTime - this.VAULT_IDLE_THRESHOLD_MS;
            const hadRecentActivity = this.lastVaultChangeTimestamp >= changeWindowStart;

            if (hadRecentActivity) {
                hadRecentChanges = true;
            }

            if (sinceLastChange >= this.VAULT_IDLE_THRESHOLD_MS) {
                if (hadRecentChanges || now - startTime >= this.VAULT_START_DELAY_MS) {
                    break;
                }
            }

            if (now - startTime >= this.VAULT_MAX_WAIT_MS) {
                break;
            }

            await this.delay(250);
        }

        if (hadRecentChanges) {
            logger.log(`[AutoCreateService] Vault activity settled after ${Date.now() - startTime}ms`);
        }
    }

    private delay(ms: number): Promise<void> {
        return new Promise((resolve) => setTimeout(resolve, ms));
    }

    private async fetchAllRemoteEvents(
        service: ExternalCalendarService, 
        urls: string[], 
        start: Date, 
        end: Date,
        filter: string
    ): Promise<ExternalCalendarEvent[]> {
        const results: ExternalCalendarEvent[] = [];
        const filterTerms = filter.split(',').map(s => s.trim().toLowerCase()).filter(Boolean);

        for (const url of urls) {
            try {
                // Fetch ALL events, including cancelled
                const events = await service.fetchEvents(url, start, end, true);
                
                for (const event of events) {
                    // Apply Title Filter (ONLY if event is NOT cancelled)
                    // If event is cancelled, we need it to trigger deletion of local note
                    if (!event.isCancelled && filterTerms.length > 0) {
                        const lowerTitle = (event.title || "").toLowerCase();
                        if (filterTerms.some(t => lowerTitle.includes(t))) {
                            continue; 
                        }
                    }
                    results.push(event);
                }
            } catch (e) {
                logger.error(`Failed to fetch ${url}`, e);
            }
        }
        return results;
    }

    private buildVaultIndex(): VaultNoteIndex[] {
        const index: VaultNoteIndex[] = [];
        const files = this.app.vault.getMarkdownFiles();
        
        for (const file of files) {
            const cache = this.app.metadataCache.getFileCache(file);
            const fm = cache?.frontmatter;
            if (!fm) continue;

            const googleEventId = fm.googleEventId ? String(fm.googleEventId) : null;
            if (!googleEventId) continue;

            // Extract UID
            // Format 1 (Standard): UID
            // Format 2 (Recurring): UID-Timestamp
            let uid = googleEventId;
            const lastDash = googleEventId.lastIndexOf('-');
            if (lastDash > 0) {
                const suffix = googleEventId.substring(lastDash + 1);
                if (/^\d+$/.test(suffix)) {
                    uid = googleEventId.substring(0, lastDash);
                }
            }

            // Start Date
            let startDate: Date | null = null;
            const startVal = fm.scheduled || fm[this.config.startProperty];
            if (startVal) {
                startDate = new Date(startVal);
            }

            index.push({
                file,
                googleEventId,
                uid,
                startDate
            });
        }
        return index;
    }

    private async processEvent(
        event: ExternalCalendarEvent, 
        index: VaultNoteIndex[],
        calendarTag: string | null,
        hiddenEvents: string[]
    ): Promise<{ action: 'created' | 'updated' | 'deleted' | 'none', file?: TFile }> {
        
        // 1. Find Matching Note
        let match = index.find(n => n.googleEventId === event.id);
        
        // 2. Fuzzy Match (For Reschedules)
        if (!match) {
            const candidates = index.filter(n => n.uid === event.uid);
            
            if (candidates.length > 0) {
                const isRecurringInstance = event.id.includes('-') && event.id !== event.uid;
                
                if (isRecurringInstance) {
                    // Extract Recurrence ID from Event ID (Remote)
                    // Format: UID-Timestamp
                    const eventRecurrenceId = event.id.substring(event.id.lastIndexOf('-') + 1);
                    const eventRidTs = parseInt(eventRecurrenceId);
                    
                    if (!isNaN(eventRidTs)) {
                        match = candidates.find(n => {
                            const noteRid = n.googleEventId.substring(n.googleEventId.lastIndexOf('-') + 1);
                            const noteRidTs = parseInt(noteRid);
                            
                            if (isNaN(noteRidTs)) return false;
                            
                            // 65 min tolerance for TZ drift
                            if (Math.abs(eventRidTs - noteRidTs) < 65 * 60 * 1000) {
                                return true;
                            }
                            
                            // Component match
                            const d1 = new Date(eventRidTs);
                            const d2 = new Date(noteRidTs);
                            if (
                                d1.getUTCHours() === d2.getUTCHours() && 
                                d1.getUTCMinutes() === d2.getUTCMinutes() &&
                                d1.getUTCDate() === d2.getUTCDate()
                            ) {
                                return true;
                            }
                            return false;
                        });
                    }
                } else {
                    // Single event
                    if (candidates.length === 1) {
                        match = candidates[0];
                    }
                }
            }
        }

        // 3. Process Match
        if (match) {
            // IS CANCELLED?
            if (event.isCancelled) {
                await this.deleteOrArchive(match.file);
                return { action: 'deleted' };
            }

            // UPDATE
            const file = match.file;
            let updated = false;

            // Update Frontmatter
            await this.app.fileManager.processFrontMatter(file, (fm) => {
                if (fm.googleEventId !== event.id) {
                    fm.googleEventId = event.id;
                    updated = true;
                }
                const fmtStart = formatDateTimeForFrontmatter(event.startDate);
                if (fm[this.config.startProperty] !== fmtStart) {
                    fm[this.config.startProperty] = fmtStart;
                    updated = true;
                }
                if (fm.scheduled !== undefined && fm.scheduled !== fmtStart) {
                    fm.scheduled = fmtStart;
                    updated = true;
                }
                // End date logic...
                // If view said useEndDuration=false, force end property
                if (!this.config.useEndDuration) {
                    const fmtEnd = formatDateTimeForFrontmatter(event.endDate);
                    if (fm[this.config.endProperty] !== fmtEnd) {
                        fm[this.config.endProperty] = fmtEnd;
                        updated = true;
                    }
                } else {
                    // Default behavior (or if useEndDuration=true): set duration
                    const dur = Math.round((event.endDate.getTime() - event.startDate.getTime()) / 60000);
                    if (fm[this.config.endProperty] !== dur) {
                        fm[this.config.endProperty] = dur;
                        updated = true;
                    }
                }
                if (fm.title !== event.title) {
                    fm.title = event.title;
                    updated = true;
                }
            });

            // Rename File
            const sanitizedTitle = event.title.replace(/[\\/:*?"<>|]/g, "").replace(/\s+/g, " ").trim();
            const dateSuffix = `${event.startDate.getFullYear()}-${String(event.startDate.getMonth() + 1).padStart(2, "0")}-${String(event.startDate.getDate()).padStart(2, "0")}`;
            const expectedPrefix = `${sanitizedTitle} ${dateSuffix}`;
            
            if (!file.basename.startsWith(expectedPrefix)) {
                await this.renameFileUnique(file, expectedPrefix, file.parent?.path || "");
                updated = true;
            }

            return { action: updated ? 'updated' : 'none', file };
        }

        // 4. Process New (Creation)
        // Check Hidden Status HERE. Only block CREATION if hidden.
        // If it was matched above, we processed it regardless of hidden status (to keep it in sync).
        if (!event.isCancelled) {
            // Stable ID check: Check if UID is hidden (for stable hiding)
            // Or if specific ID is hidden
            const isHidden = hiddenEvents.includes(event.id) || hiddenEvents.includes(event.uid);
            
            if (isHidden) {
                return { action: 'none' };
            }

            try {
                const file = await createMeetingNoteFromExternalEvent(
                    this.app,
                    event,
                    this.config.meetingNoteTemplate,
                    this.config.meetingNoteFolder,
                    this.config.startProperty,
                    this.config.endProperty,
                    this.config.useEndDuration,
                    calendarTag
                );
                if (file) return { action: 'created', file };
            } catch (e) {
                logger.error(`Failed to create note for ${event.title}`, e);
            }
        }

        return { action: 'none' };
    }

    private async deleteOrArchive(file: TFile) {
        if (this.config.syncOnEventDelete === 'delete') {
            await this.app.vault.delete(file);
        } else if (this.config.syncOnEventDelete === 'archive') {
            const archiveFolder = this.config.archiveFolder;
            if (archiveFolder) {
                if (!this.app.vault.getAbstractFileByPath(archiveFolder)) {
                    await this.app.vault.createFolder(archiveFolder);
                }
                await this.renameFileUnique(file, file.basename, archiveFolder);
            }
        } else {
            await this.markAsCancelled(file);
        }
    }

    private async markAsCancelled(file: TFile) {
        const statusValue = this.config.canceledStatusValue;
        await this.app.fileManager.processFrontMatter(file, (fm) => {
            fm.cancelled = true;
            if (statusValue) {
                fm.status = statusValue;
            }
        });
    }

    private async renameFileUnique(file: TFile, baseName: string, folderPath: string) {
        let newPath = normalizePath(`${folderPath}/${baseName}.${file.extension}`);
        let counter = 1;
        while (this.app.vault.getAbstractFileByPath(newPath)) {
            const existing = this.app.vault.getAbstractFileByPath(newPath);
            if (existing === file) return;
            newPath = normalizePath(`${folderPath}/${baseName} ${counter}.${file.extension}`);
            counter++;
        }
        await this.app.fileManager.renameFile(file, newPath);
    }
}
