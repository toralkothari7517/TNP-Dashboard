import Database from 'better-sqlite3';
import path from 'path';
import fs from 'fs';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const DB_PATH = process.env.DATABASE_PATH || path.join(__dirname, 'tnp_dashboard.db');

// Ensure db directory exists
const dbDir = path.dirname(DB_PATH);
if (!fs.existsSync(dbDir)) {
  fs.mkdirSync(dbDir, { recursive: true });
}

const db = new Database(DB_PATH);

// Enable foreign keys
db.pragma('foreign_keys = ON');

// Initialize database schema
export function initDb() {
  const schemaPath = path.join(__dirname, 'schema.sql');
  if (fs.existsSync(schemaPath)) {
    const schema = fs.readFileSync(schemaPath, 'utf8');
    db.exec(schema);
    console.log('Database schema successfully initialized.');

    // Seed mock data if companies table is empty
    const count = db.prepare('SELECT COUNT(*) as count FROM companies').get().count;
    if (count === 0) {
      console.log('Seeding mock data for TNP Dashboard...');
      
      const insertCompany = db.prepare(`
        INSERT INTO companies (company_name, role, application_link, deadline, sheet_row_id)
        VALUES (?, ?, ?, ?, ?)
      `);

      const insertQuestion = db.prepare(`
        INSERT INTO experience_questions (company_id, question_text, category)
        VALUES (?, ?, ?)
      `);

      // Set deadlines relative to current time for realistic countdowns
      const getFutureDate = (daysAhead) => {
        const d = new Date();
        d.setDate(d.getDate() + daysAhead);
        return d.toISOString().substring(0, 16); // YYYY-MM-DDTHH:mm
      };
      
      const getPastDate = (daysAgo) => {
        const d = new Date();
        d.setDate(d.getDate() - daysAgo);
        return d.toISOString().substring(0, 16);
      };

      // Seed Companies
      const microsoftId = insertCompany.run(
        'Microsoft', 
        'Software Engineering Intern', 
        'https://careers.microsoft.com', 
        getFutureDate(1), // 1 day left -> < 48 hours (Flagged!)
        'seed_1'
      ).lastInsertRowid;

      const stripeId = insertCompany.run(
        'Stripe', 
        'Frontend Engineer Intern', 
        'https://stripe.com/jobs', 
        getFutureDate(2), // 2 days left -> < 48 hours (Flagged!)
        'seed_2'
      ).lastInsertRowid;

      const googleId = insertCompany.run(
        'Google', 
        'Software Engineer Intern', 
        'https://careers.google.com', 
        getFutureDate(5), 
        'seed_3'
      ).lastInsertRowid;

      const metaId = insertCompany.run(
        'Meta', 
        'Production Engineer Intern', 
        'https://metacareers.com', 
        getFutureDate(12), 
        'seed_4'
      ).lastInsertRowid;

      const amazonId = insertCompany.run(
        'Amazon', 
        'SWE Intern', 
        'https://amazon.jobs', 
        getFutureDate(30), 
        'seed_5'
      ).lastInsertRowid;

      const netflixId = insertCompany.run(
        'Netflix', 
        'SWE Intern', 
        'https://jobs.netflix.com', 
        getPastDate(3), // Passed deadline
        'seed_6'
      ).lastInsertRowid;

      const appleId = insertCompany.run(
        'Apple', 
        'Software Engineer', 
        'https://apple.com/careers', 
        '', // No deadline
        'seed_7'
      ).lastInsertRowid;

      // Seed Questions
      // Microsoft (SWE)
      insertQuestion.run(microsoftId, 'Implement a stack with push, pop, and retrieve min element in O(1) time.', 'DSA');
      insertQuestion.run(microsoftId, 'How do you design a high-availability parking lot system?', 'System Design');
      insertQuestion.run(microsoftId, 'Tell me about a time you had to deal with a difficult teammate.', 'HR');
      
      // Stripe (Frontend)
      insertQuestion.run(stripeId, 'Design a billing dashboard with React components and handle pagination state.', 'Resume');
      insertQuestion.run(stripeId, 'Explain standard HTTP caching headers (Cache-Control, ETag, etc.).', 'OOP');
      insertQuestion.run(stripeId, 'Implement a debounced search input component in React.', 'Resume');

      // Google (SWE)
      insertQuestion.run(googleId, 'Given a binary tree, find the maximum path sum from any node to any node.', 'DSA');
      insertQuestion.run(googleId, 'What is the difference between processes and threads in memory management?', 'System Design');
      insertQuestion.run(googleId, 'Why do you want to join Google?', 'HR');

      // Meta (Production)
      insertQuestion.run(metaId, 'What happens under the hood when you type "google.com" in a web browser?', 'System Design');
      insertQuestion.run(metaId, 'Explain OOP concepts: Inheritance, Polymorphism, Encapsulation with real-life analogies.', 'OOP');
      
      // Amazon (SWE)
      insertQuestion.run(amazonId, 'Given an array of integers, return indices of the two numbers that add up to a target.', 'DSA');
      insertQuestion.run(amazonId, 'Explain how a hash map handles collisions internally.', 'DSA');

      // Seeding sync log
      db.prepare(`
        INSERT INTO sync_log (status, rows_synced, error_message)
        VALUES (?, ?, ?)
      `).run('SUCCESS', 7, 'Database Seeding successful');
      
      console.log('Seeding completed successfully.');
    }
  } else {
    console.warn('Schema file not found at:', schemaPath);
  }
}

export default db;
