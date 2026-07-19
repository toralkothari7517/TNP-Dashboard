import { google } from 'googleapis';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const TOKENS_PATH = path.join(__dirname, '..', 'tokens.json');

// Initialize OAuth2 client using environment variables or credentials.json fallback
const getOAuth2Client = () => {
  let clientId = process.env.GOOGLE_CLIENT_ID;
  let clientSecret = process.env.GOOGLE_CLIENT_SECRET;
  let redirectUri = process.env.GOOGLE_REDIRECT_URI || 'http://localhost:5000/api/auth/google/callback';

  const CREDENTIALS_PATH = path.join(__dirname, '..', 'credentials.json');
  if ((!clientId || !clientSecret) && fs.existsSync(CREDENTIALS_PATH)) {
    try {
      const credsData = JSON.parse(fs.readFileSync(CREDENTIALS_PATH, 'utf8'));
      const web = credsData.web || credsData.installed;
      if (web) {
        clientId = clientId || web.client_id;
        clientSecret = clientSecret || web.client_secret;
        if (web.redirect_uris && web.redirect_uris.length > 0 && !process.env.GOOGLE_REDIRECT_URI) {
          redirectUri = web.redirect_uris[0];
        }
      }
    } catch (err) {
      console.error('Failed to parse credentials.json:', err);
    }
  }

  if (!clientId || !clientSecret) {
    throw new Error('Google OAuth credentials (GOOGLE_CLIENT_ID, GOOGLE_CLIENT_SECRET) are not set in environmental variables or credentials.json.');
  }

  const oauth2Client = new google.auth.OAuth2(clientId, clientSecret, redirectUri);

  // Automatically save refreshed tokens
  oauth2Client.on('tokens', (tokens) => {
    try {
      let currentTokens = {};
      if (fs.existsSync(TOKENS_PATH)) {
        currentTokens = JSON.parse(fs.readFileSync(TOKENS_PATH, 'utf8'));
      }
      const updatedTokens = { ...currentTokens, ...tokens };
      fs.writeFileSync(TOKENS_PATH, JSON.stringify(updatedTokens, null, 2));
      console.log('Google OAuth tokens refreshed and saved to tokens.json');
    } catch (err) {
      console.error('Failed to save refreshed tokens:', err);
    }
  });

  return oauth2Client;
};

// Check if credentials are local and set them on client
export const getAuthenticatedClient = () => {
  const client = getOAuth2Client();

  if (fs.existsSync(TOKENS_PATH)) {
    const tokens = JSON.parse(fs.readFileSync(TOKENS_PATH, 'utf8'));
    client.setCredentials(tokens);
    return client;
  }

  return null;
};

// Generate Consent Screen URL
export const getAuthUrl = () => {
  const client = getOAuth2Client();
  return client.generateAuthUrl({
    access_type: 'offline', // Request refresh token
    scope: ['https://www.googleapis.com/auth/spreadsheets.readonly'],
    prompt: 'consent' // Force display of consent screen to ensure refresh token is returned
  });
};

// Exchange auth code for token
export const saveCredentials = async (code) => {
  const client = getOAuth2Client();
  const { tokens } = await client.getToken(code);
  
  // Save tokens to JSON
  fs.writeFileSync(TOKENS_PATH, JSON.stringify(tokens, null, 2));
  console.log('Google OAuth tokens saved successfully to tokens.json');
  
  client.setCredentials(tokens);
  return client;
};

// Revoke access / clear tokens
export const clearCredentials = () => {
  if (fs.existsSync(TOKENS_PATH)) {
    fs.unlinkSync(TOKENS_PATH);
  }
};

// Check if tokens.json exists
export const checkAuthStatus = () => {
  if (!fs.existsSync(TOKENS_PATH)) {
    return { authenticated: false };
  }
  try {
    const tokens = JSON.parse(fs.readFileSync(TOKENS_PATH, 'utf8'));
    return { 
      authenticated: true, 
      expiry_date: tokens.expiry_date,
      has_refresh_token: !!tokens.refresh_token 
    };
  } catch (e) {
    return { authenticated: false, error: e.message };
  }
};

// Fetch values from a range in a Google Sheet
export const fetchSheetValues = async (sheetId, range) => {
  const client = getAuthenticatedClient();
  if (!client) {
    throw new Error('Google Sheets client is not authenticated. Please authenticate first.');
  }

  const sheets = google.sheets({ version: 'v4', auth: client });
  const response = await sheets.spreadsheets.values.get({
    spreadsheetId: sheetId,
    range: range || 'Sheet1!A:D', // Fallback default range
  });

  return response.data.values;
};

// Get the title of the first sheet (tab) in the spreadsheet
export const getFirstSheetTitle = async (sheetId) => {
  const client = getAuthenticatedClient();
  if (!client) {
    throw new Error('Google Sheets client is not authenticated. Please authenticate first.');
  }

  const sheets = google.sheets({ version: 'v4', auth: client });
  const response = await sheets.spreadsheets.get({
    spreadsheetId: sheetId,
  });

  const sheetsList = response.data.sheets;
  if (sheetsList && sheetsList.length > 0) {
    return sheetsList[0].properties.title;
  }
  return 'Sheet1';
};
