// Script to fix meeting note frontmatter
// Run this in Obsidian Developer Console

(async () => {
  const files = app.vault.getMarkdownFiles();
  let fixed = 0;
  let skipped = 0;
  
  for (const file of files) {
    // Only process files in Events folder
    if (!file.path.includes('01 Action Items/Events')) continue;
    
    const cache = app.metadataCache.getFileCache(file);
    if (!cache?.frontmatter) continue;
    
    const fm = cache.frontmatter;
    let needsUpdate = false;
    
    // Check if needs fixing
    const hasEmptyScheduled = fm.scheduled === null || fm.scheduled === undefined || fm.scheduled === '';
    const hasDate = fm.date !== null && fm.date !== undefined && fm.date !== '';
    const hasEnd = fm.end !== null && fm.end !== undefined;
    const hasEmptyTimeEstimate = fm.timeEstimate === null || fm.timeEstimate === undefined || fm.timeEstimate === '';
    
    if ((hasEmptyScheduled && hasDate) || (hasEmptyTimeEstimate && hasEnd)) {
      needsUpdate = true;
    }
    
    if (!needsUpdate) {
      skipped++;
      continue;
    }
    
    await app.fileManager.processFrontMatter(file, (frontmatter) => {
      // Fix scheduled field
      if ((frontmatter.scheduled === null || frontmatter.scheduled === undefined || frontmatter.scheduled === '') && frontmatter.date) {
        frontmatter.scheduled = frontmatter.date;
        delete frontmatter.date;
      }
      
      // Fix timeEstimate field
      if ((frontmatter.timeEstimate === null || frontmatter.timeEstimate === undefined || frontmatter.timeEstimate === '') && frontmatter.end !== undefined) {
        frontmatter.timeEstimate = frontmatter.end;
        delete frontmatter.end;
      }
    });
    
    fixed++;
    console.log(`Fixed: ${file.path}`);
  }
  
  console.log(`\nDone! Fixed ${fixed} files, skipped ${skipped} files`);
})();
