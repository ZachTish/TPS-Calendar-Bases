# Weekly Calendar Bases

**Adds a powerful weekly time-grid calendar layout to Obsidian Bases, powered by FullCalendar, with external calendar sync and meeting note automation.**

![Obsidian Plugin](https://img.shields.io/badge/dynamic/json-blue?label=Obsidian%20Plugin&query=version)
![License](https://img.shields.io/badge/license-MIT-green.svg)
![Build](https://img.shields.io/github/workflows/CI/TPS-Calendar-Bases)

## ✨ Features

### 📅 Calendar Integration
- **Weekly View**: Time-grid calendar layout optimized for week-based planning
- **Bases Compatible**: Seamlessly integrates with Obsidian Bases data
- **FullCalendar Powered**: Professional calendar interface with extensive features
- **Real-time Updates**: Automatic synchronization with vault changes

### 🌐 External Calendar Sync
- **iCal Support**: Subscribe to external calendars (Google, Outlook, etc.)
- **Multiple Sources**: Add unlimited calendar subscriptions
- **Custom Filters**: Filter events by keywords, tags, or categories
- **Color Coding**: Per-calendar color and tag configuration
- **Recurring Events**: Full support for complex recurrence patterns

### 📝 Meeting Automation
- **Auto-Creation**: Automatically generate meeting notes from calendar events
- **Template Integration**: Use custom templates for meeting notes
- **Smart Scheduling**: Create notes before meetings with reminders
- **Bidirectional Sync**: Changes sync back to calendar events
- **Folder Organization**: Automatic filing of meeting notes

### 🎨 Styling & Customization
- **Priority Colors**: Visual priority indicators (High/Medium/Low)
- **Status Styling**: Color-code events by status (Complete/In Progress/Blocked)
- **Text Styles**: Bold, italic, strikethrough text formatting
- **Condense Levels**: Control event detail density in calendar view

## 🚀 Installation

### Via BRAT (Recommended for Testing)
1. Install the [BRAT plugin](https://github.com/TfTHacker/obsidian42-brat) in Obsidian
2. Go to Settings → Community Plugins → Add BRAT plugin
3. Add this repository URL: `https://github.com/ZachTish/TPS-Calendar-Bases`
4. Enable "Weekly Calendar Bases" in your installed plugins
5. Create a new Base with Calendar view type

### Via Release (Stable)
1. Download the latest [release](https://github.com/ZachTish/TPS-Calendar-Bases/releases)
2. Extract the contents to your vault's plugins folder
3. Restart Obsidian and enable the plugin
4. Create a new Base and select "Calendar" as the view type

## 📖 Usage

### Basic Setup

1. **Create Calendar Base**: Go to Create → New Base → Calendar
2. **Configure Data Source**: Select your notes database or create new one
3. **Set Up External Calendars**: Add iCal URLs for external event sources
4. **Customize View**: Adjust colors, filters, and display options
5. **Configure Meeting Notes**: Set up templates and folder structure

### Adding External Calendars

#### Google Calendar
1. Go to Google Calendar → Settings → Export calendar
2. Copy the "Secret address in iCal format" URL
3. Add to TPS Calendar Settings → External Calendars
4. Configure custom color and filter settings

#### Other Calendars
- **Outlook**: Share → Get calendar link → ICS
- **Apple Calendar**: Share → Calendar Link → Copy
- **Exchange**: Web access → Export as ICS

### Meeting Note Automation

#### Setup Process
1. **Configure Folder**: Set destination folder in plugin settings
2. **Create Template**: Design your meeting note template
3. **Enable Auto-Creation**: Turn on automation for external events
4. **Test Integration**: Create a test event to verify the workflow

#### Template Variables
```markdown
# {{title}}
**Date:** {{date}}
**Time:** {{time}}
**Attendees:** {{attendees}}

## Agenda
{{agenda}}

## Notes
{{notes}}
```

### Calendar Styling

#### Priority Colors
- **High**: Red background with white text
- **Medium**: Yellow background with dark text
- **Low**: Green background with dark text
- **Custom**: Define your own color scheme

#### Status Indicators
- **Complete**: Green border and checkmark
- **In Progress**: Blue border with clock icon
- **Blocked**: Red border with warning icon
- **Cancelled**: Gray background with strikethrough

#### Text Formatting
- **Bold**: Important event titles
- **Italic**: Tentative or optional events
- **Strikethrough**: Cancelled or completed events
- **Normal**: Default text styling

## ⚙️ Settings

### Calendar Configuration
- **Default View**: Set initial calendar view (Week/Month/Day)
- **Time Zone**: Configure local time zone handling
- **Week Start Day**: Choose Sunday or Monday week start
- **Working Hours**: Define business hours for calendar display

### External Calendar Settings
- **Calendar URLs**: Add/edit/remove calendar subscriptions
- **Refresh Interval**: Set sync frequency (5-60 minutes)
- **Filter Strings**: Global filter for all external calendars
- **Color Overrides**: Custom colors per calendar
- **Tag Mapping**: Map calendar tags to specific colors

### Meeting Note Settings
- **Template Path**: Location of meeting note templates
- **Folder Path**: Where to store generated meeting notes
- **Auto-Creation**: Enable/disable automatic note creation
- **Reminder Timing**: When to create meeting notes (15-60 minutes before)
- **Sync Settings**: Bidirectional sync options

### Styling Options
- **Priority Color Map**: Customize priority indicator colors
- **Status Style Map**: Configure status-based styling
- **Text Style Options**: Bold, italic, strikethrough settings
- **Condense Level**: Control event detail density (0-3)

## 🎯 Use Cases

### **Project Management**
- Visual timeline of project milestones
- External calendar integration with client meetings
- Automatic meeting documentation

### **Personal Productivity**
- Weekly planning with external life events
- Meeting preparation with automated notes
- Task tracking with visual indicators

### **Team Collaboration**
- Shared calendar views for team coordination
- External calendar subscriptions for team events
- Centralized meeting note system

## 🔧 Technical Details

### Calendar Engine
- **FullCalendar Core**: Professional JavaScript calendar library
- **React Integration**: Modern, reactive UI components
- **iCal Parsing**: Robust parsing with `ical.js` library
- **Recurrence Support**: Full RRULE specification compliance

### Data Sync
- **Real-time Updates**: Automatic refresh on vault changes
- **External Sync**: Configurable polling for external calendars
- **Bidirectional**: Two-way sync with external systems
- **Conflict Resolution**: Smart handling of conflicting events

### Performance Features
- **Virtual Scrolling**: Efficient rendering of large date ranges
- **Lazy Loading**: Load data only when needed
- **Caching System**: Intelligent caching for improved responsiveness
- **Memory Management**: Optimized memory usage patterns

## 📋 Commands

### Calendar Commands
- **Refresh Calendars**: Force refresh all calendar sources
- **Go to Today**: Jump to current date in calendar
- **Create External Event**: Quick event creation modal
- **Toggle View**: Switch between calendar view types

### Meeting Commands
- **Create Meeting Note**: Manual meeting note creation
- **Sync External Events**: Force sync with external calendars
- **Clear Cache**: Clear calendar and external event cache
- **Open Settings**: Quick access to calendar configuration

## 🐛 Troubleshooting

### Common Issues

#### Events Not Displaying
- Check that your Base has the correct view type (Calendar)
- Verify filter settings aren't hiding events
- Ensure external calendar URLs are accessible and valid
- Check time zone settings match your location

#### External Sync Not Working
- Verify iCal URL is publicly accessible
- Check firewall/proxy settings for external access
- Ensure calendar provider supports iCal export
- Test URL in browser to confirm it loads

#### Meeting Notes Not Creating
- Check that auto-creation is enabled in settings
- Verify template path is correct and accessible
- Ensure external events have required metadata
- Check folder permissions for destination directory

#### Performance Issues
- Increase sync intervals for external calendars
- Reduce the number of external calendar subscriptions
- Enable condense level to reduce rendered details
- Clear cache if calendar becomes unresponsive

### Debug Mode
Enable logging to troubleshoot:
- External calendar fetching errors
- iCal parsing issues
- Meeting note creation failures
- Performance bottlenecks and timing

## 📋 Changelog

### v0.1.0 (2024-01-17)
- ✅ Initial release
- ✅ Weekly calendar grid layout
- ✅ External iCal calendar integration
- ✅ Meeting note automation
- ✅ Advanced styling and customization
- ✅ Performance optimizations

## 🔧 Development

### Building from Source
```bash
# Clone the repository
git clone https://github.com/ZachTish/TPS-Calendar-Bases.git
cd TPS-Calendar-Bases

# Install dependencies
npm install

# Build the plugin
npm run build

# Watch for changes during development
npm run dev

# Build with calendar bundling
npm run bundle-to-weekly
```

### Contributing
1. Fork the repository
2. Create a feature branch: `git checkout -b feature/amazing-feature`
3. Commit your changes: `git commit -m 'feat: Add amazing feature'`
4. Push to the branch: `git push origin feature/amazing-feature`
5. Open a Pull Request against the `develop` branch

## 📄 License

This project is licensed under the MIT License - see the [LICENSE](LICENSE) file for details.

## 🤝 Contributing

Contributions are welcome! Please read our [Contributing Guidelines](CONTRIBUTING.md) for details on our code of conduct and the process for submitting pull requests.

## 🔗 Links

- **Repository**: https://github.com/ZachTish/TPS-Calendar-Bases
- **Issues**: https://github.com/ZachTish/TPS-Calendar-Bases/issues
- **Discussions**: https://github.com/ZachTish/TPS-Calendar-Bases/discussions
- **Releases**: https://github.com/ZachTish/TPS-Calendar-Bases/releases

---

**Made with ❤️ for the Obsidian community**