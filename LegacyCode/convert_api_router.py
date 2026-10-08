import re

with open('src/server/api-router.ts', 'r') as f:
    content = f.read()

# I need to add express router.
import_express = "import { Router, Request, Response } from 'express';\n"
if "import { Router" not in content:
    content = import_express + content

# I will replace handleRequest with getRouter()
# First, remove handleRequest and readJsonBody completely.
content = re.sub(r'public async handleRequest.*?\s*private async readJsonBody.*?\}', '', content, flags=re.DOTALL)

# Now, add getRouter
get_router = """
  public getRouter(): Router {
    const router = Router();
    
    // Status
    router.get('/status', (req, res) => this.handleGetStatus(res));
    
    // Config
    router.get('/config', (req, res) => this.handleGetConfig(res));
    router.post('/config/people', (req, res) => this.handleSavePeople(req.body, res));
    router.post('/config/settings', (req, res) => this.handleSaveSettings(req.body, res));
    router.post('/config/pat', (req, res) => this.handleSavePat(req.body, res));
    
    // Tasks
    router.get('/tasks/live', (req, res) => this.handleGetLiveTasks(res));
    router.post('/tasks/plan', (req, res) => this.handlePlanTasks(req.body, res));
    router.post('/tasks/execute', (req, res) => this.handleExecuteTasks(req.body, res));
    
    // Explorer
    router.get('/explorer', (req, res) => {
      // Create a mock URL object so existing code works
      const url = new URL(req.originalUrl, `http://${req.headers.host}`);
      this.handleGetExplorer(url, res);
    });
    router.post('/explorer/create-missing', (req, res) => this.handleCreateMissingFromExplorer(req.body, res));
    
    // Journal / Audit
    router.get('/journal', (req, res) => this.handleGetJournal(res));
    router.get('/journal/export', (req, res) => {
      const url = new URL(req.originalUrl, `http://${req.headers.host}`);
      this.handleExportJournal(url, res);
    });
    
    // Scheduler
    router.get('/scheduler', (req, res) => this.handleGetScheduler(res));
    router.post('/scheduler/toggle', (req, res) => this.handleToggleScheduler(req.body, res));
    
    // Logs
    router.get('/logs', (req, res) => {
      const url = new URL(req.originalUrl, `http://${req.headers.host}`);
      this.handleGetLogs(url, res);
    });
    router.get('/logs/stream', (req, res) => this.handleStreamLogs(req, res));
    
    return router;
  }

  // Wrapper for sendJson so existing methods don't break
  private sendJson(res: any, statusCode: number, data: any): void {
    if (res.status) {
      res.status(statusCode).json(data);
    } else {
      // Fallback for native res if ever called directly
      res.writeHead(statusCode, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify(data));
    }
  }
"""

content = content.replace("private sendJson(res: ServerResponse, statusCode: number, data: any): void {", "/* replaced */ private _oldSendJson() {")
content = content.replace("export class ApiRouter {", "export class ApiRouter {" + get_router)

# We have to fix handleStreamLogs to use express Response
content = content.replace("handleStreamLogs(req: IncomingMessage, res: ServerResponse)", "handleStreamLogs(req: any, res: any)")

with open('src/server/api-router.ts', 'w') as f:
    f.write(content)

