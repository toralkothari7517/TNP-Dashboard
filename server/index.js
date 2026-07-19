import express from 'express';
import cors from 'cors';
import dotenv from 'dotenv';
import path from 'path';
import { fileURLToPath } from 'url';
import db, { initDb } from './db/index.js';
import { 
  getAuthUrl, 
  saveCredentials, 
  checkAuthStatus, 
  clearCredentials 
} from './services/googleSheets.js';
import { runSync } from './services/sync.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Load environment variables from root directory
dotenv.config({ path: path.join(__dirname, '../.env') });

const app = express();
const PORT = process.env.PORT || 5000;

// Enable CORS
app.use(cors({
  origin: process.env.CLIENT_URL || 'http://localhost:5173',
  credentials: true
}));

app.use(express.json());

// Initialize SQLite database schema
initDb();

// ==========================================
// GOOGLE OAUTH ROUTES
// ==========================================

// Get authorization status and details
app.get('/api/auth/status', (req, res) => {
  try {
    const status = checkAuthStatus();
    res.json(status);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Get the Google Auth URL
app.get('/api/auth/google/url', (req, res) => {
  try {
    const authUrl = getAuthUrl();
    const status = checkAuthStatus();
    res.json({ authUrl, authenticated: status.authenticated });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// OAuth Redirect Callback
app.get('/api/auth/google/callback', async (req, res) => {
  const { code } = req.query;
  if (!code) {
    return res.status(400).send('OAuth code is missing from callback URL.');
  }

  try {
    await saveCredentials(code);
    
    // Redirect back to the client dashboard
    const clientUrl = process.env.CLIENT_URL || 'http://localhost:5173';
    res.redirect(`${clientUrl}?auth=success`);
  } catch (err) {
    console.error('Error during Google Auth callback:', err);
    res.status(500).send(`Authentication failed: ${err.message}`);
  }
});

// Logout (revoke/delete credentials)
app.post('/api/auth/logout', (req, res) => {
  try {
    clearCredentials();
    res.json({ success: true, message: 'Logged out successfully.' });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ==========================================
// SYNC ROUTE
// ==========================================

app.post('/api/sync', async (req, res) => {
  try {
    const syncStatus = checkAuthStatus();
    if (!syncStatus.authenticated) {
      return res.status(401).json({ 
        success: false, 
        error: 'Google Sheets is not authorized. Please log in.',
        authRequired: true 
      });
    }

    const result = await runSync();
    res.json(result);
  } catch (err) {
    console.error('Sync failed:', err);
    res.status(500).json({ 
      success: false, 
      error: err.message,
      fallback: true
    });
  }
});

// Get recent sync logs
app.get('/api/sync/logs', (req, res) => {
  try {
    const logs = db.prepare('SELECT * FROM sync_log ORDER BY timestamp DESC LIMIT 20').all();
    res.json(logs);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ==========================================
// COMPANIES ROUTES
// ==========================================

// Get all companies sorted by deadline
app.get('/api/companies', (req, res) => {
  try {
    const companies = db.prepare(`
      SELECT c.*, 
             (SELECT COUNT(*) FROM experience_questions WHERE company_id = c.id) as question_count 
      FROM companies c
    `).all();
    
    // Fetch last successful sync time
    const lastSync = db.prepare(`
      SELECT timestamp FROM sync_log 
      WHERE status = 'SUCCESS' 
      ORDER BY timestamp DESC 
      LIMIT 1
    `).get();
    
    const lastSyncedAt = lastSync ? lastSync.timestamp : null;

    const now = new Date();
    
    // Enrich with deadline metrics and sort
    const sorted = companies.map(c => {
      let parsedDeadline = null;
      let diffMs = null;
      let diffDays = null;
      let isNear = false; // Within 48 hours
      let isPast = false;
      
      if (c.deadline) {
        parsedDeadline = new Date(c.deadline);
        if (!isNaN(parsedDeadline.getTime())) {
          diffMs = parsedDeadline.getTime() - now.getTime();
          diffDays = diffMs / (1000 * 60 * 60 * 24);
          isPast = diffMs < 0;
          // If the deadline is today/tomorrow or less than 2 days away, flag as near
          isNear = !isPast && diffDays <= 2;
        } else {
          parsedDeadline = null;
        }
      }
      
      return {
        ...c,
        parsedDeadline,
        diffDays,
        isNear,
        isPast
      };
    }).sort((a, b) => {
      // 1. Put companies without deadline at the bottom
      if (!a.parsedDeadline && !b.parsedDeadline) {
        return a.company_name.localeCompare(b.company_name);
      }
      if (!a.parsedDeadline) return 1;
      if (!b.parsedDeadline) return -1;
      
      // 2. Put upcoming deadlines before past deadlines
      if (a.isPast && !b.isPast) return 1;
      if (!a.isPast && b.isPast) return -1;
      
      // 3. If both are upcoming, sort ascending (nearest first)
      if (!a.isPast && !b.isPast) {
        return a.parsedDeadline.getTime() - b.parsedDeadline.getTime();
      } 
      
      // 4. If both are past, sort descending (most recently passed first)
      return b.parsedDeadline.getTime() - a.parsedDeadline.getTime();
    });

    res.json({
      companies: sorted,
      lastSyncedAt
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// CSV bulk import for companies
app.post('/api/companies/import', (req, res) => {
  const { companies } = req.body;
  if (!Array.isArray(companies)) {
    return res.status(400).json({ error: 'Invalid data format. Expected an array of companies.' });
  }
  
  const upsertStmt = db.prepare(`
    INSERT INTO companies (company_name, role, application_link, deadline, sheet_row_id, updated_at)
    VALUES (?, ?, ?, ?, ?, CURRENT_TIMESTAMP)
    ON CONFLICT(company_name, role) DO UPDATE SET
      application_link = excluded.application_link,
      deadline = excluded.deadline,
      updated_at = CURRENT_TIMESTAMP
  `);
  
  const transaction = db.transaction((data) => {
    let count = 0;
    for (const item of data) {
      // Map multiple potential CSV header styles
      const name = item.company_name || item.company || item['Company Name'] || item['Company'] || '';
      const role = item.role || item['Role'] || 'Intern / Full Time';
      const link = item.application_link || item.link || item['Application Link'] || item['Link'] || '';
      const deadline = item.deadline || item['Deadline'] || '';
      
      if (name.trim()) {
        const sheetRowId = `csv_${Date.now()}_${Math.random().toString(36).substring(2, 7)}`;
        upsertStmt.run(name.trim(), role.trim(), link.trim(), deadline.trim(), sheetRowId);
        count++;
      }
    }
    return count;
  });
  
  try {
    const count = transaction(companies);
    
    // Log manual sync
    db.prepare(`
      INSERT INTO sync_log (status, rows_synced, error_message)
      VALUES (?, ?, ?)
    `).run('SUCCESS', count, 'CSV Fallback Import');
    
    res.json({ success: true, count });
  } catch (err) {
    console.error('CSV import failed:', err);
    res.status(500).json({ error: err.message });
  }
});

// ==========================================
// EXPERIENCE QUESTIONS ROUTES
// ==========================================

// Get questions for a specific company
app.get('/api/companies/:id/questions', (req, res) => {
  const { id } = req.params;
  try {
    const questions = db.prepare('SELECT * FROM experience_questions WHERE company_id = ? ORDER BY created_at DESC').all(id);
    res.json(questions);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Get all questions with company details
app.get('/api/questions', (req, res) => {
  try {
    const questions = db.prepare(`
      SELECT eq.*, c.company_name, c.role 
      FROM experience_questions eq 
      JOIN companies c ON eq.company_id = c.id 
      ORDER BY eq.created_at DESC
    `).all();
    res.json(questions);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Add a single question
app.post('/api/questions', (req, res) => {
  const { company_id, question_text, category } = req.body;
  if (!company_id || !question_text || !category) {
    return res.status(400).json({ error: 'Missing required fields: company_id, question_text, category' });
  }

  try {
    const stmt = db.prepare(`
      INSERT INTO experience_questions (company_id, question_text, category)
      VALUES (?, ?, ?)
    `);
    const result = stmt.run(company_id, question_text, category);
    
    const newQuestion = db.prepare('SELECT * FROM experience_questions WHERE id = ?').get(result.lastInsertRowid);
    res.json({ success: true, question: newQuestion });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// CSV bulk import for questions
app.post('/api/questions/import', (req, res) => {
  const { questions } = req.body;
  if (!Array.isArray(questions)) {
    return res.status(400).json({ error: 'Invalid data format. Expected an array of questions.' });
  }

  const getCompanyStmt = db.prepare('SELECT id FROM companies WHERE LOWER(company_name) = LOWER(?) LIMIT 1');
  const insertCompanyStmt = db.prepare(`
    INSERT INTO companies (company_name, role, deadline, sheet_row_id)
    VALUES (?, ?, ?, ?)
  `);
  
  const insertQuestionStmt = db.prepare(`
    INSERT INTO experience_questions (company_id, question_text, category)
    VALUES (?, ?, ?)
  `);
  
  const transaction = db.transaction((data) => {
    let count = 0;
    for (const item of data) {
      const compName = item.company_name || item.company || item['Company Name'] || item['Company'] || '';
      const role = item.role || item['Role'] || 'Intern / Full Time';
      const qText = item.question_text || item.question || item['Question Text'] || item['Question'] || '';
      const category = item.category || item['Category'] || 'DSA';
      
      if (compName.trim() && qText.trim()) {
        // Look up company case-insensitively
        let company = getCompanyStmt.get(compName.trim());
        let companyId;
        
        if (!company) {
          // If the company does not exist, insert a shell record to link
          const sheetRowId = `shell_${Date.now()}_${Math.random().toString(36).substring(2, 7)}`;
          const result = insertCompanyStmt.run(compName.trim(), role.trim(), '', sheetRowId);
          companyId = result.lastInsertRowid;
        } else {
          companyId = company.id;
        }
        
        insertQuestionStmt.run(companyId, qText.trim(), category.trim());
        count++;
      }
    }
    return count;
  });

  try {
    const count = transaction(questions);
    res.json({ success: true, count });
  } catch (err) {
    console.error('CSV question import failed:', err);
    res.status(500).json({ error: err.message });
  }
});

// ==========================================
// SUMMARY STATS ROUTE
// ==========================================

app.get('/api/stats', (req, res) => {
  try {
    const totalCompanies = db.prepare('SELECT COUNT(*) as count FROM companies').get().count;
    const totalQuestions = db.prepare('SELECT COUNT(*) as count FROM experience_questions').get().count;
    
    const lastSync = db.prepare(`
      SELECT timestamp, status, error_message 
      FROM sync_log 
      ORDER BY timestamp DESC 
      LIMIT 1
    `).get();
    
    // Category distribution counts
    const categoryCounts = db.prepare(`
      SELECT category, COUNT(*) as count 
      FROM experience_questions 
      GROUP BY category
    `).all();
    
    // Calculate upcoming deadlines count
    const nowStr = new Date().toISOString().substring(0, 10);
    const upcomingCount = db.prepare(`
      SELECT COUNT(*) as count FROM companies 
      WHERE deadline >= ? AND deadline != ''
    `).get(nowStr).count;

    res.json({
      totalCompanies,
      totalQuestions,
      lastSync: lastSync || null,
      categoryCounts,
      upcomingCount
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Start Server
app.listen(PORT, () => {
  console.log(`Server running at http://localhost:${PORT}`);
  console.log(`CORS allowed for client at ${process.env.CLIENT_URL || 'http://localhost:5173'}`);
});
