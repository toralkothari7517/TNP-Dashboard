import db from '../db/index.js';
import { fetchSheetValues, getFirstSheetTitle } from './googleSheets.js';

// Parse a date string into a standard ISO format (YYYY-MM-DD or YYYY-MM-DDTHH:mm:ss)
const parseDeadline = (dateStr) => {
  if (!dateStr) return '';
  const cleanStr = dateStr.trim();
  const parsed = Date.parse(cleanStr);
  if (!isNaN(parsed)) {
    // If it successfully parses, return the ISO date portion or full date
    const d = new Date(parsed);
    // Return YYYY-MM-DD
    const month = String(d.getMonth() + 1).padStart(2, '0');
    const day = String(d.getDate()).padStart(2, '0');
    const year = d.getFullYear();
    
    // Check if it has time info
    if (cleanStr.includes(':') || cleanStr.toLowerCase().includes('am') || cleanStr.toLowerCase().includes('pm')) {
      const hours = String(d.getHours()).padStart(2, '0');
      const minutes = String(d.getMinutes()).padStart(2, '0');
      return `${year}-${month}-${day}T${hours}:${minutes}`;
    }
    return `${year}-${month}-${day}`;
  }
  
  // Fallback to original string if standard parsing fails
  return cleanStr;
};

// Perform the sync operation
export const runSync = async () => {
  let sheetId = process.env.GOOGLE_SHEET_ID;
  if (sheetId) {
    sheetId = sheetId.trim();
    const urlMatch = sheetId.match(/\/d\/([a-zA-Z0-9-_]+)/);
    if (urlMatch) {
      sheetId = urlMatch[1];
    } else {
      sheetId = sheetId.replace(/\/$/, '');
    }
  }
  const range = process.env.GOOGLE_SHEET_RANGE || 'Sheet1!A:E'; // Use A:E in case there's an ID or extra col

  if (!sheetId) {
    throw new Error('GOOGLE_SHEET_ID is not configured in environment variables.');
  }

  let rows = [];
  try {
    rows = await fetchSheetValues(sheetId, range);
  } catch (err) {
    // If it was a range parsing error, auto-detect the sheet title and try again
    if (err.message && (err.message.includes('Unable to parse range') || err.message.includes('not found') || err.message.includes('INVALID_ARGUMENT'))) {
      console.log('Specified range failed. Attempting to auto-detect the first sheet tab...');
      try {
        const firstTitle = await getFirstSheetTitle(sheetId);
        const newRange = `${firstTitle}!A:E`;
        console.log(`Auto-detected sheet title: "${firstTitle}". Retrying with range: "${newRange}"`);
        rows = await fetchSheetValues(sheetId, newRange);
      } catch (retryErr) {
        db.prepare(`
          INSERT INTO sync_log (status, rows_synced, error_message)
          VALUES (?, ?, ?)
        `).run('FAILURE', 0, `Retry with auto-detected sheet failed: ${retryErr.message}`);
        throw retryErr;
      }
    } else {
      // Log failure to db
      db.prepare(`
        INSERT INTO sync_log (status, rows_synced, error_message)
        VALUES (?, ?, ?)
      `).run('FAILURE', 0, err.message);
      throw err;
    }
  }

  if (!rows || rows.length === 0) {
    // No data retrieved
    db.prepare(`
      INSERT INTO sync_log (status, rows_synced, error_message)
      VALUES (?, ?, ?)
    `).run('SUCCESS', 0, 'No rows found in sheet');
    return { success: true, count: 0 };
  }

  // Detect header row (typically row 0)
  let startIndex = 0;
  const firstRowStr = JSON.stringify(rows[0]).toLowerCase();
  if (firstRowStr.includes('company') || firstRowStr.includes('role') || firstRowStr.includes('deadline') || firstRowStr.includes('link')) {
    startIndex = 1;
  }

  const upsertStmt = db.prepare(`
    INSERT INTO companies (company_name, role, application_link, deadline, sheet_row_id, updated_at)
    VALUES (?, ?, ?, ?, ?, CURRENT_TIMESTAMP)
    ON CONFLICT(company_name, role) DO UPDATE SET
      application_link = excluded.application_link,
      deadline = excluded.deadline,
      sheet_row_id = excluded.sheet_row_id,
      updated_at = CURRENT_TIMESTAMP
  `);

  let count = 0;

  // Run database insertions inside a transaction for atomic efficiency
  const transaction = db.transaction((dataRows) => {
    for (let i = startIndex; i < dataRows.length; i++) {
      const row = dataRows[i];
      // Skip empty rows
      if (!row || row.length === 0 || !row[0]) continue;

      const companyName = row[0] ? row[0].trim() : '';
      const role = row[1] ? row[1].trim() : 'Intern / Full Time';
      const appLink = row[2] ? row[2].trim() : '';
      const rawDeadline = row[3] ? row[3].trim() : '';
      const deadline = parseDeadline(rawDeadline);
      
      // Use the row index + company + role as a stable sheet row ID
      const sheetRowId = `row_${i}_${encodeURIComponent(companyName)}_${encodeURIComponent(role)}`;

      if (companyName) {
        upsertStmt.run(companyName, role, appLink, deadline, sheetRowId);
        count++;
      }
    }
  });

  try {
    transaction(rows);

    // Log success
    db.prepare(`
      INSERT INTO sync_log (status, rows_synced, error_message)
      VALUES (?, ?, ?)
    `).run('SUCCESS', count, null);

    return { success: true, count };
  } catch (err) {
    console.error('Database transaction error during sync:', err);
    db.prepare(`
      INSERT INTO sync_log (status, rows_synced, error_message)
      VALUES (?, ?, ?)
    `).run('FAILURE', 0, `Database error: ${err.message}`);
    throw err;
  }
};
