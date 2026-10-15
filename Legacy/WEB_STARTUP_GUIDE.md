# Azure Board Legacy - Web Application Startup Guide

## 🚀 Quick Start

### Prerequisites
- Node.js (v16+)
- npm or yarn
- Personal Access Token (PAT) from Azure DevOps with Work Items Read/Write access

### Environment Setup

1. **Copy environment template:**
```bash
cp .env.example .env
```

2. **Edit .env and add your credentials:**
```env
AZURE_DEVOPS_PAT="your_personal_access_token_here"
AZURE_DEVOPS_ORG="BFLDevOpsOrg"
AZURE_DEVOPS_PROJECT="3in1_Agile_Projects"
AZURE_DEVOPS_TIMEZONE="Asia/Kolkata"
```

3. **Configure team members (people.json):**
```json
[
  {
    "key": "person1",
    "name": "John Doe",
    "assignedTo": "john@company.com",
    "enabled": true,
    "sourceTaskId": 12345
  },
  {
    "key": "person2",
    "name": "Jane Smith",
    "assignedTo": "jane@company.com",
    "enabled": true
  }
]
```

### Install Dependencies
```bash
npm install
```

### Start Web UI

**Development Mode:**
```bash
npm start
# or
npm run ui
# or
npm run serve
```

The application will start at: **http://localhost:3000**

**Production Mode:**
```bash
npm run build
npm run start:prod
```

### Available NPM Scripts

| Command | Purpose |
|---------|---------|
| `npm start` | Launch web UI (development) |
| `npm run serve` | Alias for web UI launch |
| `npm run ui` | Alias for web UI launch |
| `npm run build` | Compile TypeScript to dist/ |
| `npm run create-tasks` | Run CLI task creation |
| `npm run dry-run` | Preview without creating tasks |
| `npm run daemon` | Start daily scheduler (background) |
| `npm run typecheck` | Check TypeScript types |
| `npm test` | Run test suite |

---

## 🌐 Web UI Features

### Dashboard (Overview Tab)
- Real-time task matrix with creation windows
- KPI cards showing team members, rolling window, tasks to create
- Live task status (planned, duplicate, existing)
- Daily burndown chart
- Task distribution statistics

### Daily Burndown Tab
- Monthly work intelligence matrix
- Task count and effort tracking
- Completion status per team member
- Date-wise progress visualization

### My Work Tab
- Personalized work view for current user
- Task assignments and deadlines
- Progress tracking

### Team Insights Tab
- Team member management
- Add/edit/delete team members
- Configure source tasks per person
- Enable/disable team members

### Task Explorer Tab
- Advanced date-range filtering
- User-wise task coverage matrix
- Missing vs. created task analysis
- Duplicate detection
- Custom date presets (today, this week, current month, etc.)

### Activity & Audit Tab
- Complete execution journal
- Timestamp and operation tracking
- Work item creation history
- Error logging and recovery

### Settings Tab
- Azure DevOps organization/project configuration
- Personal Access Token (PAT) management
- Timezone settings
- Thursday mode configuration (CURRENT vs FOLLOWING)
- Connection testing

### Daily Scheduler
- Enable/disable automatic daily execution
- Configure execution time (default: 09:30 AM)
- Automatic work item creation on schedule

---

## 🔧 API Endpoints

All endpoints are prefixed with `/api/`

### Configuration
- `GET /status` - System status and connection verification
- `GET /config` - Load current configuration
- `POST /config/people` - Update team members
- `POST /config/settings` - Update settings
- `POST /config/pat` - Update Personal Access Token

### Task Operations
- `GET /tasks/live` - Get live task matrix
- `POST /tasks/plan` - Plan tasks for specific people/date
- `POST /tasks/execute` - Execute task creation

### Exploration & Analytics
- `GET /explorer` - Explore tasks in date range
- `POST /explorer/create-missing` - Create missing tasks from explorer

### Audit & Logging
- `GET /journal` - Get execution journal entries
- `GET /journal/export` - Export journal (CSV/JSON)
- `POST /journal/repair` - Repair incomplete relationships

### Scheduler
- `GET /scheduler` - Get scheduler status
- `POST /scheduler/toggle` - Enable/disable scheduler

### Logs
- `GET /logs` - Get recent logs
- `GET /logs/stream` - Stream logs in real-time

---

## 📊 Data Flow

```
User Browser (Web UI)
    ↓
index.html + app.js + styles.css
    ↓
fetch() API calls to /api/
    ↓
Express Server (server.ts)
    ↓
API Router (api-router.ts)
    ↓
Business Logic (task-orchestrator.ts, task-explorer.ts)
    ↓
Azure DevOps Client (client.ts)
    ↓
Azure DevOps REST API
    ↓
Response → JSON → UI Rendering
```

---

## 🛡️ Security Features

✅ **Credential Management:**
- PAT stored securely in .env
- Never logged or exposed in responses
- All credentials masked in logs

✅ **Error Handling:**
- Proper HTTP status validation
- User-friendly error messages
- No sensitive data in error messages

✅ **Data Protection:**
- CORS enabled for cross-origin requests
- JSON body parsing with validation
- Duplicate prevention mechanisms

---

## 🔍 Troubleshooting

### "Cannot find module" error
```bash
npm install
```

### Port already in use
The app automatically tries the next port:
- Port 3000 is busy → tries 3001, 3002, etc.

### PAT Authentication Failed
1. Verify PAT in .env is correct
2. Ensure PAT has Work Items Read/Write permissions
3. Check organization name matches Azure DevOps

### No data loading
1. Run `npm run typecheck` to verify no TypeScript errors
2. Check browser console for fetch errors
3. Verify Azure DevOps connection: Settings → Test Connection

### Scheduler not running
1. Ensure scheduler is enabled in Settings
2. Check if process is still running: `ps aux | grep node`
3. Verify .env has correct PAT

---

## 📝 Configuration Files

### .env
Environment variables for Azure DevOps connection

### people.json
Team member configuration with:
- Name and email
- Azure DevOps assigned-to identity
- Optional source task ID
- Enable/disable flag

### tsconfig.json
TypeScript compilation settings

### package.json
Dependencies and npm scripts

---

## 🎯 Next Steps

1. **Start the application:**
   ```bash
   npm start
   ```

2. **Configure settings:**
   - Go to Settings tab
   - Enter your Azure DevOps organization
   - Set your PAT
   - Click "Test Connection"

3. **Add team members:**
   - Go to Team Insights tab
   - Click "Add Person"
   - Enter details and save

4. **View tasks:**
   - Go to Overview tab
   - See the task matrix
   - Click "Create for [Person]" to execute

---

## 💡 Tips

- Use "Simulate Window" button to preview next cycle
- "Dry Run" in Settings shows what would be created without creating
- Export journal to track all operations
- Use Task Explorer to find missing or duplicate tasks
- Enable scheduler for automatic daily execution

---

**Status:** ✅ Production Ready
**Last Updated:** October 9, 2026
