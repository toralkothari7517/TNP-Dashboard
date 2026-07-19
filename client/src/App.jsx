import React, { useState, useEffect } from 'react';
import Papa from 'papaparse';
import { 
  Briefcase, 
  Calendar, 
  ExternalLink, 
  RefreshCw, 
  Search, 
  Plus, 
  Check, 
  FileText, 
  BarChart3, 
  ChevronDown, 
  ChevronUp, 
  LogOut, 
  Key, 
  Upload, 
  Copy, 
  X, 
  AlertTriangle,
  Database,
  Building,
  GraduationCap
} from 'lucide-react';
import './App.css';

const API_BASE = 'http://localhost:5000/api';

// Helper to determine deadline countdown badge
const getCountdown = (deadlineStr) => {
  if (!deadlineStr) return { text: 'No deadline', color: 'badge-muted', isUrgent: false };
  
  const now = new Date();
  const deadline = new Date(deadlineStr);
  
  if (isNaN(deadline.getTime())) {
    return { text: deadlineStr, color: 'badge-muted', isUrgent: false };
  }
  
  const diffMs = deadline.getTime() - now.getTime();
  const diffDays = Math.ceil(diffMs / (1000 * 60 * 60 * 24));
  
  if (diffMs < 0) {
    return { text: 'Passed', color: 'badge-muted', isUrgent: false, isPassed: true };
  }
  
  // Flag within 48 hours
  if (diffMs <= 2 * 24 * 60 * 60 * 1000) {
    const hours = Math.round(diffMs / (1000 * 60 * 60));
    return { text: `${hours} hrs left`, color: 'badge-urgent', isUrgent: true };
  }
  
  return { 
    text: `${diffDays} days left`, 
    color: diffDays <= 5 ? 'badge-warning' : 'badge-success', 
    isUrgent: false 
  };
};

const getCategoryColor = (cat) => {
  switch (cat.toUpperCase()) {
    case 'DSA': return '#3b82f6'; // Blue
    case 'OOP': return '#8b5cf6'; // Purple
    case 'SYSTEM DESIGN': return '#ec4899'; // Pink
    case 'HR': return '#10b981'; // Emerald
    case 'RESUME': return '#f59e0b'; // Amber
    default: return '#94a3b8'; // Slate
  }
};

function App() {
  const [activeTab, setActiveTab] = useState('dashboard');
  const [companies, setCompanies] = useState([]);
  const [lastSyncedAt, setLastSyncedAt] = useState(null);
  const [questions, setQuestions] = useState([]);
  const [stats, setStats] = useState(null);
  const [authStatus, setAuthStatus] = useState({ authenticated: false });
  
  // Search & filter state
  const [searchTerm, setSearchTerm] = useState('');
  const [selectedCategory, setSelectedCategory] = useState('ALL');
  const [deadlineFilter, setDeadlineFilter] = useState('ALL'); // ALL, URGENT, UPCOMING, PASSED
  
  // Expanded company state (stores loaded questions for expanded companies)
  const [expandedCompanies, setExpandedCompanies] = useState({}); // { companyId: true/false }
  const [companyQuestions, setCompanyQuestions] = useState({}); // { companyId: [questions] }
  
  // Add question forms (for specific companies in-card)
  const [inlineNewQuestion, setInlineNewQuestion] = useState({}); // { companyId: { text: '', category: 'DSA' } }
  
  // Global new question form (for questions view)
  const [globalQuestion, setGlobalQuestion] = useState({
    company_id: '',
    question_text: '',
    category: 'DSA'
  });

  // Modal controls
  const [showImportCompanies, setShowImportCompanies] = useState(false);
  const [showImportQuestions, setShowImportQuestions] = useState(false);
  
  // Parsing states
  const [parsedCompaniesPreview, setParsedCompaniesPreview] = useState([]);
  const [parsedQuestionsPreview, setParsedQuestionsPreview] = useState([]);
  const [companiesFile, setCompaniesFile] = useState(null);
  const [questionsFile, setQuestionsFile] = useState(null);

  const [isSyncing, setIsSyncing] = useState(false);
  const [toast, setToast] = useState(null);

  // ==========================================
  // INITIAL LOAD
  // ==========================================
  
  useEffect(() => {
    fetchData();
    // Check if OAuth redirected back with code=success
    const urlParams = new URLSearchParams(window.location.search);
    if (urlParams.get('auth') === 'success') {
      showToast('success', 'Google Sheets authorized successfully!');
      // Clean URL parameters
      window.history.replaceState({}, document.title, window.location.pathname);
    }
  }, []);

  const fetchData = async () => {
    await Promise.all([
      fetchCompanies(),
      fetchQuestions(),
      fetchStats(),
      fetchAuthStatus()
    ]);
  };

  const fetchCompanies = async () => {
    try {
      const res = await fetch(`${API_BASE}/companies`);
      const data = await res.json();
      setCompanies(data.companies || []);
      setLastSyncedAt(data.lastSyncedAt);
    } catch (err) {
      console.error('Failed to fetch companies:', err);
      showToast('error', 'Failed to fetch companies list.');
    }
  };

  const fetchQuestions = async () => {
    try {
      const res = await fetch(`${API_BASE}/questions`);
      const data = await res.json();
      setQuestions(data || []);
    } catch (err) {
      console.error('Failed to fetch questions:', err);
    }
  };

  const fetchStats = async () => {
    try {
      const res = await fetch(`${API_BASE}/stats`);
      const data = await res.json();
      setStats(data);
    } catch (err) {
      console.error('Failed to fetch stats:', err);
    }
  };

  const fetchAuthStatus = async () => {
    try {
      const res = await fetch(`${API_BASE}/auth/status`);
      const data = await res.json();
      setAuthStatus(data);
    } catch (err) {
      console.error('Failed to fetch auth status:', err);
    }
  };

  // Toast notifier helper
  const showToast = (type, message) => {
    setToast({ type, message });
    setTimeout(() => setToast(null), 4000);
  };

  // ==========================================
  // SYNC & OAUTH ACTIONS
  // ==========================================

  const triggerSync = async () => {
    setIsSyncing(true);
    try {
      const res = await fetch(`${API_BASE}/sync`, { method: 'POST' });
      const data = await res.json();
      
      if (res.ok && data.success) {
        showToast('success', `Synced ${data.count} rows from Google Sheets!`);
        await fetchData();
      } else {
        throw new Error(data.error || 'Unknown error');
      }
    } catch (err) {
      console.error('Sync failed:', err);
      showToast('error', `Sync failed: ${err.message}. Using offline cache.`);
    } finally {
      setIsSyncing(false);
    }
  };

  const handleAuthorize = async () => {
    try {
      const res = await fetch(`${API_BASE}/auth/google/url`);
      const data = await res.json();
      if (data.authUrl) {
        window.location.href = data.authUrl;
      } else {
        showToast('error', 'Could not retrieve Google Authorization URL.');
      }
    } catch (err) {
      showToast('error', 'Failed to initiate Google OAuth.');
    }
  };

  const handleLogout = async () => {
    try {
      await fetch(`${API_BASE}/auth/logout`, { method: 'POST' });
      setAuthStatus({ authenticated: false });
      showToast('success', 'Logged out and cleared tokens.');
    } catch (err) {
      showToast('error', 'Logout failed.');
    }
  };

  // ==========================================
  // EXPANSION & SUB-COMPONENTS ACTIONS
  // ==========================================

  const toggleCompanyExpand = async (id) => {
    const isExpanded = !expandedCompanies[id];
    setExpandedCompanies(prev => ({ ...prev, [id]: isExpanded }));

    if (isExpanded && !companyQuestions[id]) {
      // Load questions for company
      try {
        const res = await fetch(`${API_BASE}/companies/${id}/questions`);
        const data = await res.json();
        setCompanyQuestions(prev => ({ ...prev, [id]: data }));
      } catch (err) {
        console.error('Failed to load company questions:', err);
      }
    }
  };

  const handleAddInlineQuestion = async (companyId) => {
    const form = inlineNewQuestion[companyId] || { text: '', category: 'DSA' };
    if (!form.text.trim()) return;

    try {
      const res = await fetch(`${API_BASE}/questions`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          company_id: companyId,
          question_text: form.text,
          category: form.category
        })
      });
      
      const data = await res.json();
      if (data.success) {
        showToast('success', 'Interview question added successfully!');
        // Reset form
        setInlineNewQuestion(prev => ({
          ...prev,
          [companyId]: { text: '', category: 'DSA' }
        }));
        // Update loaded questions
        setCompanyQuestions(prev => ({
          ...prev,
          [companyId]: [data.question, ...(prev[companyId] || [])]
        }));
        // Refresh global state
        fetchQuestions();
        fetchStats();
      } else {
        showToast('error', data.error || 'Failed to add question.');
      }
    } catch (err) {
      showToast('error', 'Server error. Question not added.');
    }
  };

  const copyToClipboard = (text) => {
    navigator.clipboard.writeText(text);
    showToast('success', 'Copied question to clipboard!');
  };

  // ==========================================
  // CSV FILE PARSING
  // ==========================================

  const handleCompaniesCSVSelect = (e) => {
    const file = e.target.files[0];
    if (!file) return;
    setCompaniesFile(file);

    Papa.parse(file, {
      header: true,
      skipEmptyLines: true,
      complete: (results) => {
        setParsedCompaniesPreview(results.data.slice(0, 5));
      },
      error: (error) => {
        showToast('error', `CSV parsing failed: ${error.message}`);
      }
    });
  };

  const submitCompaniesCSV = async () => {
    if (!companiesFile) return;

    Papa.parse(companiesFile, {
      header: true,
      skipEmptyLines: true,
      complete: async (results) => {
        try {
          const res = await fetch(`${API_BASE}/companies/import`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ companies: results.data })
          });
          const data = await res.json();
          if (res.ok) {
            showToast('success', `Imported ${data.count} companies!`);
            setShowImportCompanies(false);
            setCompaniesFile(null);
            setParsedCompaniesPreview([]);
            await fetchData();
          } else {
            showToast('error', data.error || 'Import failed');
          }
        } catch (err) {
          showToast('error', 'Failed to connect to backend for import.');
        }
      }
    });
  };

  const handleQuestionsCSVSelect = (e) => {
    const file = e.target.files[0];
    if (!file) return;
    setQuestionsFile(file);

    Papa.parse(file, {
      header: true,
      skipEmptyLines: true,
      complete: (results) => {
        setParsedQuestionsPreview(results.data.slice(0, 5));
      },
      error: (error) => {
        showToast('error', `CSV parsing failed: ${error.message}`);
      }
    });
  };

  const submitQuestionsCSV = async () => {
    if (!questionsFile) return;

    Papa.parse(questionsFile, {
      header: true,
      skipEmptyLines: true,
      complete: async (results) => {
        try {
          const res = await fetch(`${API_BASE}/questions/import`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ questions: results.data })
          });
          const data = await res.json();
          if (res.ok) {
            showToast('success', `Imported ${data.count} interview questions!`);
            setShowImportQuestions(false);
            setQuestionsFile(null);
            setParsedQuestionsPreview([]);
            await fetchData();
          } else {
            showToast('error', data.error || 'Import failed');
          }
        } catch (err) {
          showToast('error', 'Failed to connect to backend for import.');
        }
      }
    });
  };

  const submitGlobalQuestion = async (e) => {
    e.preventDefault();
    if (!globalQuestion.company_id || !globalQuestion.question_text.trim()) {
      showToast('error', 'Please select a company and fill in the question text.');
      return;
    }

    try {
      const res = await fetch(`${API_BASE}/questions`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(globalQuestion)
      });
      const data = await res.json();
      if (data.success) {
        showToast('success', 'Question added!');
        setGlobalQuestion({
          company_id: '',
          question_text: '',
          category: 'DSA'
        });
        await fetchQuestions();
        await fetchStats();
      } else {
        showToast('error', data.error || 'Failed to add');
      }
    } catch (e) {
      showToast('error', 'Server error');
    }
  };

  // ==========================================
  // FILTERS AND COMPUTATIONS
  // ==========================================

  // Filter companies
  const filteredCompanies = companies.filter(c => {
    // Search filter
    const matchesSearch = 
      c.company_name.toLowerCase().includes(searchTerm.toLowerCase()) ||
      c.role.toLowerCase().includes(searchTerm.toLowerCase());

    // Deadline urgency filter
    if (!matchesSearch) return false;
    
    if (deadlineFilter === 'ALL') return true;
    
    // Urgent means isNear = true
    if (deadlineFilter === 'URGENT') return c.isNear === 1 || c.isNear === true;
    // Upcoming means not past and has a deadline
    if (deadlineFilter === 'UPCOMING') return c.deadline && !c.isPast;
    // Passed means isPast = true
    if (deadlineFilter === 'PASSED') return c.isPast === 1 || c.isPast === true;

    return true;
  });

  // Filter questions bank
  const filteredQuestions = questions.filter(q => {
    const matchesSearch = 
      q.company_name.toLowerCase().includes(searchTerm.toLowerCase()) ||
      q.question_text.toLowerCase().includes(searchTerm.toLowerCase());

    const matchesCategory = selectedCategory === 'ALL' || q.category.toUpperCase() === selectedCategory.toUpperCase();
    
    return matchesSearch && matchesCategory;
  });

  // Format date helper
  const formatDate = (dateStr) => {
    if (!dateStr) return 'No Deadline Set';
    const d = new Date(dateStr);
    if (isNaN(d.getTime())) return dateStr;
    return d.toLocaleString([], { dateStyle: 'medium', timeStyle: 'short' });
  };

  // Format sync timestamp
  const formatSyncTime = (timestamp) => {
    if (!timestamp) return 'Never Synced';
    const d = new Date(timestamp);
    return d.toLocaleString();
  };

  return (
    <div className="dashboard-container">
      {/* Toast Alert */}
      {toast && (
        <div className={`toast toast-${toast.type} animate-fade-in`}>
          {toast.type === 'success' ? <Check size={18} /> : <AlertTriangle size={18} />}
          <span>{toast.message}</span>
        </div>
      )}

      {/* NAV HEADER */}
      <header className="glass-panel nav-header">
        <div className="brand-section">
          <div className="brand-logo">T</div>
          <div className="brand-title">
            <h1>TNP Dashboard</h1>
            <p>Placement & Internship Track Engine</p>
          </div>
        </div>

        <div className="nav-controls">
          <nav className="nav-tabs">
            <button 
              className={`nav-tab-btn ${activeTab === 'dashboard' ? 'active' : ''}`}
              onClick={() => setActiveTab('dashboard')}
            >
              <Briefcase size={16} />
              Applications
            </button>
            <button 
              className={`nav-tab-btn ${activeTab === 'questions' ? 'active' : ''}`}
              onClick={() => setActiveTab('questions')}
            >
              <GraduationCap size={16} />
              Interview Bank
            </button>
          </nav>

          <div className="oauth-container">
            {authStatus.authenticated ? (
              <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                <span className="badge badge-success" style={{ padding: '6px 12px' }}>
                  <Check size={12} /> Google Synced
                </span>
                <button className="btn btn-secondary btn-icon" onClick={handleLogout} title="Revoke Auth">
                  <LogOut size={16} />
                </button>
              </div>
            ) : (
              <button className="btn btn-secondary" onClick={handleAuthorize}>
                <Key size={16} /> Authorize Sheet
              </button>
            )}
          </div>
        </div>
      </header>

      {/* STATS BAR */}
      {stats && (
        <section className="stats-grid animate-fade-in">
          <div className="glass-panel stat-widget">
            <div className="stat-icon-wrapper primary">
              <Building size={24} />
            </div>
            <div className="stat-info">
              <h3>{stats.totalCompanies}</h3>
              <p>TRACKED COMPANIES</p>
            </div>
          </div>

          <div className="glass-panel stat-widget">
            <div className="stat-icon-wrapper warning">
              <Calendar size={24} />
            </div>
            <div className="stat-info">
              <h3>{stats.upcomingCount}</h3>
              <p>UPCOMING DEADLINES</p>
            </div>
          </div>

          <div className="glass-panel stat-widget">
            <div className="stat-icon-wrapper success">
              <BarChart3 size={24} />
            </div>
            <div className="stat-info">
              <h3>{stats.totalQuestions}</h3>
              <p>STORED QUESTIONS</p>
            </div>
          </div>

          <div className="glass-panel stat-widget" style={{ flexGrow: 1.5 }}>
            <div className="stat-icon-wrapper primary" style={{ background: 'rgba(255, 255, 255, 0.05)', color: '#94a3b8' }}>
              <Database size={24} />
            </div>
            <div className="stat-info">
              <p style={{ color: 'var(--text-secondary)', fontWeight: 700 }}>LAST SYNC ENGINE STATE</p>
              <div style={{ fontSize: '0.825rem', marginTop: '4px', display: 'flex', flexDirection: 'column' }}>
                <span>📅 {formatSyncTime(lastSyncedAt)}</span>
                {stats.lastSync && (
                  <span style={{ 
                    color: stats.lastSync.status === 'SUCCESS' ? '#6ee7b7' : '#fda4af', 
                    fontSize: '0.75rem',
                    fontWeight: 600
                  }}>
                    Status: {stats.lastSync.status} {stats.lastSync.error_message && `(${stats.lastSync.error_message})`}
                  </span>
                )}
              </div>
            </div>
          </div>
        </section>
      )}

      {/* CONTROLS BAR (SEARCH / IMPORT) */}
      <section className="search-filter-row animate-fade-in">
        <div className="search-wrapper">
          <Search size={18} className="search-input-icon" />
          <input 
            type="text" 
            placeholder={activeTab === 'dashboard' ? 'Search by company or role...' : 'Search questions or companies...'} 
            className="input-field search-input"
            value={searchTerm}
            onChange={(e) => setSearchTerm(e.target.value)}
          />
        </div>

        <div className="filter-controls">
          {activeTab === 'dashboard' ? (
            <>
              <button 
                className={`btn ${deadlineFilter === 'ALL' ? 'btn-primary' : 'btn-secondary'}`}
                onClick={() => setDeadlineFilter('ALL')}
              >
                All
              </button>
              <button 
                className={`btn ${deadlineFilter === 'URGENT' ? 'btn-danger' : 'btn-secondary'}`}
                onClick={() => setDeadlineFilter('URGENT')}
              >
                🚨 Urgent (&lt;48h)
              </button>
              <button 
                className={`btn ${deadlineFilter === 'UPCOMING' ? 'btn-primary' : 'btn-secondary'}`}
                style={deadlineFilter === 'UPCOMING' ? { background: 'var(--success-gradient)' } : {}}
                onClick={() => setDeadlineFilter('UPCOMING')}
              >
                Upcoming
              </button>
              <button 
                className={`btn ${deadlineFilter === 'PASSED' ? 'btn-primary' : 'btn-secondary'}`}
                style={deadlineFilter === 'PASSED' ? { background: 'var(--accent-warning-gradient)' } : {}}
                onClick={() => setDeadlineFilter('PASSED')}
              >
                Passed
              </button>
            </>
          ) : (
            <select 
              className="input-field" 
              style={{ width: '160px' }}
              value={selectedCategory}
              onChange={(e) => setSelectedCategory(e.target.value)}
            >
              <option value="ALL">All Categories</option>
              <option value="DSA">DSA</option>
              <option value="OOP">OOP</option>
              <option value="SYSTEM DESIGN">System Design</option>
              <option value="HR">HR</option>
              <option value="RESUME">Resume</option>
            </select>
          )}

          <div style={{ width: '1px', height: '24px', background: 'rgba(255,255,255,0.1)' }}></div>

          <button 
            className="btn btn-primary" 
            onClick={triggerSync} 
            disabled={isSyncing || !authStatus.authenticated}
            title={!authStatus.authenticated ? "Please Authorize Google Sheets first" : "Pull latest rows from Google Sheets"}
          >
            <RefreshCw size={14} className={isSyncing ? 'animate-spin' : ''} />
            {isSyncing ? 'Syncing...' : 'Sync Sheet'}
          </button>

          <button className="btn btn-secondary" onClick={() => setShowImportCompanies(true)}>
            <Upload size={14} /> Import Companies
          </button>
          
          <button className="btn btn-secondary" onClick={() => setShowImportQuestions(true)}>
            <Upload size={14} /> Import Qs
          </button>
        </div>
      </section>

      {/* ==========================================
          DASHBOARD VIEW
          ========================================== */}
      {activeTab === 'dashboard' && (
        <section className="companies-grid animate-fade-in">
          {filteredCompanies.length === 0 ? (
            <div className="glass-panel" style={{ gridColumn: '1 / -1', padding: '40px', textAlignment: 'center' }}>
              <p style={{ color: 'var(--text-secondary)' }}>No companies found. Try clearing filters, syncing, or uploading a CSV.</p>
            </div>
          ) : (
            filteredCompanies.map(c => {
              const countdown = getCountdown(c.deadline);
              const isExpanded = expandedCompanies[c.id];
              const qList = companyQuestions[c.id] || [];
              
              // Calculate category stats for CSS chart
              const catCounts = qList.reduce((acc, q) => {
                const cat = q.category.toUpperCase();
                acc[cat] = (acc[cat] || 0) + 1;
                return acc;
              }, {});
              const totalQ = qList.length;

              return (
                <div key={c.id} className="glass-panel glass-card animate-fade-in">
                  <div className="company-card-header">
                    <div className="company-title-info">
                      <h2>{c.company_name}</h2>
                      <p>{c.role}</p>
                    </div>
                    <span className={`badge ${countdown.color}`}>
                      {countdown.isUrgent && '🚨 '}
                      {countdown.text}
                    </span>
                  </div>

                  <div className="company-card-body">
                    <div className="info-item deadline-active">
                      <Calendar size={14} />
                      <span>{formatDate(c.deadline)}</span>
                    </div>
                    {c.application_link ? (
                      <div className="info-item">
                        <ExternalLink size={14} />
                        <a 
                          href={c.application_link.startsWith('http') ? c.application_link : `https://${c.application_link}`} 
                          target="_blank" 
                          rel="noopener noreferrer"
                          className="app-link"
                        >
                          Application Page
                        </a>
                      </div>
                    ) : (
                      <div className="info-item text-muted">
                        <ExternalLink size={14} />
                        <span>No application link</span>
                      </div>
                    )}
                  </div>

                  <div className="company-card-footer">
                    <button 
                      className="btn btn-secondary btn-icon" 
                      style={{ fontSize: '0.8rem', padding: '6px 12px' }}
                      onClick={() => toggleCompanyExpand(c.id)}
                    >
                      {isExpanded ? <ChevronUp size={16} /> : <ChevronDown size={16} />}
                      {isExpanded ? 'Hide Prep' : `Prep Bank (${companyQuestions[c.id] ? companyQuestions[c.id].length : (c.question_count || 0)})`}
                    </button>
                    
                    <span style={{ fontSize: '0.7rem', color: 'var(--text-muted)' }}>
                      Updated: {new Date(c.updated_at).toLocaleDateString()}
                    </span>
                  </div>

                  {/* EXPANDED INTERVIEW PREP PANEL */}
                  {isExpanded && (
                    <div className="company-expanded-panel">
                      {/* 1. Category Distribution Charts */}
                      {totalQ > 0 && (
                        <div className="expanded-section">
                          <h4 className="expanded-section-title">
                            <BarChart3 size={12} /> Prep Category Mix
                          </h4>
                          <div className="chart-container" style={{ marginTop: '8px' }}>
                            {['DSA', 'OOP', 'SYSTEM DESIGN', 'HR', 'RESUME'].map(cat => {
                              const count = catCounts[cat] || 0;
                              const pct = totalQ > 0 ? (count / totalQ) * 100 : 0;
                              return (
                                <div key={cat} className="chart-bar-group">
                                  <span className="chart-label">{cat}</span>
                                  <div className="chart-bar-bg">
                                    <div 
                                      className="chart-bar-fill" 
                                      style={{ 
                                        width: `${pct}%`, 
                                        background: getCategoryColor(cat) 
                                      }}
                                    ></div>
                                  </div>
                                  <span className="chart-value">{count}</span>
                                </div>
                              );
                            })}
                          </div>
                        </div>
                      )}

                      {/* 2. Questions List */}
                      <div className="expanded-section">
                        <h4 className="expanded-section-title">
                          <FileText size={12} /> Stored Questions ({totalQ})
                        </h4>
                        <div className="questions-list" style={{ marginTop: '8px' }}>
                          {qList.length === 0 ? (
                            <p style={{ fontSize: '0.75rem', color: 'var(--text-muted)' }}>
                              No questions recorded for this company yet. Add one below!
                            </p>
                          ) : (
                            qList.map(q => (
                              <div key={q.id} className="question-item">
                                <div className="question-content">
                                  <p className="question-text">{q.question_text}</p>
                                  <div className="question-meta">
                                    <span 
                                      className="category-badge"
                                      style={{ 
                                        background: `${getCategoryColor(q.category)}20`, 
                                        color: getCategoryColor(q.category),
                                        border: `1px solid ${getCategoryColor(q.category)}40`
                                      }}
                                    >
                                      {q.category}
                                    </span>
                                  </div>
                                </div>
                                <button 
                                  className="btn-copy" 
                                  title="Copy Question" 
                                  onClick={() => copyToClipboard(q.question_text)}
                                >
                                  <Copy size={13} />
                                </button>
                              </div>
                            ))
                          )}
                        </div>
                      </div>

                      {/* 3. Add Question Form */}
                      <div className="quick-add-form">
                        <span style={{ fontSize: '0.8rem', fontWeight: 700, color: 'var(--text-secondary)' }}>
                          Add Past Question
                        </span>
                        <div style={{ display: 'flex', gap: '8px', marginTop: '6px' }}>
                          <input 
                            type="text" 
                            placeholder="Type interview question here..." 
                            className="input-field" 
                            style={{ flex: 1, padding: '8px' }}
                            value={inlineNewQuestion[c.id]?.text || ''}
                            onChange={(e) => setInlineNewQuestion(prev => ({
                              ...prev,
                              [c.id]: {
                                text: e.target.value,
                                category: prev[c.id]?.category || 'DSA'
                              }
                            }))}
                          />
                          <select 
                            className="input-field" 
                            style={{ width: '90px', padding: '8px' }}
                            value={inlineNewQuestion[c.id]?.category || 'DSA'}
                            onChange={(e) => setInlineNewQuestion(prev => ({
                              ...prev,
                              [c.id]: {
                                text: prev[c.id]?.text || '',
                                category: e.target.value
                              }
                            }))}
                          >
                            <option value="DSA">DSA</option>
                            <option value="OOP">OOP</option>
                            <option value="SYSTEM DESIGN">System Design</option>
                            <option value="HR">HR</option>
                            <option value="RESUME">Resume</option>
                          </select>
                          <button 
                            className="btn btn-primary" 
                            style={{ padding: '8px' }}
                            onClick={() => handleAddInlineQuestion(c.id)}
                          >
                            <Plus size={16} />
                          </button>
                        </div>
                      </div>
                    </div>
                  )}
                </div>
              );
            })
          )}
        </section>
      )}

      {/* ==========================================
          INTERVIEW PREP BANK VIEW
          ========================================== */}
      {activeTab === 'questions' && (
        <section className="question-bank-container animate-fade-in">
          {/* Add Question Panel */}
          <div className="glass-panel" style={{ padding: '20px' }}>
            <h2 style={{ fontSize: '1.15rem', fontWeight: 800, marginBottom: '16px', borderBottom: '1px solid rgba(255,255,255,0.05)', paddingBottom: '10px' }}>
              Add Interview Question
            </h2>
            <form onSubmit={submitGlobalQuestion} style={{ display: 'flex', flexDirection: 'column', gap: '14px' }}>
              <div className="form-group">
                <label className="form-label">Target Company</label>
                <select 
                  className="input-field"
                  required
                  value={globalQuestion.company_id}
                  onChange={(e) => setGlobalQuestion(prev => ({ ...prev, company_id: e.target.value }))}
                >
                  <option value="" disabled>-- Select Company --</option>
                  {companies.map(c => (
                    <option key={c.id} value={c.id}>{c.company_name} - {c.role}</option>
                  ))}
                </select>
              </div>

              <div className="form-group">
                <label className="form-label">Question Category</label>
                <select 
                  className="input-field"
                  value={globalQuestion.category}
                  onChange={(e) => setGlobalQuestion(prev => ({ ...prev, category: e.target.value }))}
                >
                  <option value="DSA">Data Structures & Algorithms (DSA)</option>
                  <option value="OOP">Object Oriented Programming (OOP)</option>
                  <option value="SYSTEM DESIGN">System Design</option>
                  <option value="HR">HR / Behavioral</option>
                  <option value="RESUME">Resume-Specific / Projects</option>
                </select>
              </div>

              <div className="form-group">
                <label className="form-label">Question Text</label>
                <textarea 
                  className="input-field" 
                  rows={4}
                  required
                  placeholder="Paste the technical, behavioral, or resume question asked..."
                  value={globalQuestion.question_text}
                  onChange={(e) => setGlobalQuestion(prev => ({ ...prev, question_text: e.target.value }))}
                  style={{ resize: 'vertical' }}
                />
              </div>

              <button type="submit" className="btn btn-primary" style={{ width: '100%', justifyContent: 'center' }}>
                <Plus size={16} /> Save to Bank
              </button>
            </form>
          </div>

          {/* Stored Questions View */}
          <div className="questions-grid">
            <div className="questions-grid-header">
              <h2 style={{ fontSize: '1.15rem', fontWeight: 800 }}>
                Past Interview Questions ({filteredQuestions.length})
              </h2>
            </div>

            {filteredQuestions.length === 0 ? (
              <div className="glass-panel" style={{ padding: '40px', textAlignment: 'center' }}>
                <p style={{ color: 'var(--text-secondary)' }}>
                  No questions match the current filters. Add a question or import a CSV to populate.
                </p>
              </div>
            ) : (
              filteredQuestions.map(q => (
                <div key={q.id} className="glass-panel glass-card question-card animate-fade-in">
                  <div className="question-card-header">
                    <div className="question-card-company">
                      🏢 {q.company_name} <span style={{ color: 'var(--text-muted)', fontWeight: 500 }}>({q.role})</span>
                    </div>
                    <span 
                      className="category-badge"
                      style={{ 
                        background: `${getCategoryColor(q.category)}20`, 
                        color: getCategoryColor(q.category),
                        border: `1px solid ${getCategoryColor(q.category)}40`
                      }}
                    >
                      {q.category}
                    </span>
                  </div>
                  <p style={{ fontSize: '0.9rem', color: 'var(--text-primary)', marginTop: '8px', lineHeight: '1.4' }}>
                    {q.question_text}
                  </p>
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginTop: '12px', borderTop: '1px solid rgba(255,255,255,0.03)', paddingTop: '8px' }}>
                    <span style={{ fontSize: '0.7rem', color: 'var(--text-muted)' }}>
                      Added: {new Date(q.created_at).toLocaleDateString()}
                    </span>
                    <button 
                      className="btn btn-secondary btn-icon" 
                      style={{ padding: '6px' }}
                      title="Copy Question Text"
                      onClick={() => copyToClipboard(q.question_text)}
                    >
                      <Copy size={12} />
                    </button>
                  </div>
                </div>
              ))
            )}
          </div>
        </section>
      )}

      {/* ==========================================
          IMPORT COMPANIES MODAL
          ========================================== */}
      {showImportCompanies && (
        <div className="modal-backdrop">
          <div className="glass-panel modal-content animate-fade-in">
            <div className="modal-header">
              <h2>Import Companies CSV</h2>
              <button className="modal-close" onClick={() => { setShowImportCompanies(false); setCompaniesFile(null); setParsedCompaniesPreview([]); }}>
                <X size={20} />
              </button>
            </div>

            <div className="csv-template-info">
              💡 <strong>Expected CSV headers:</strong> <code>company_name</code> (or <code>company</code>), <code>role</code>, <code>application_link</code> (or <code>link</code>), <code>deadline</code> (ISO format recommended).
            </div>

            <label className="csv-dropzone">
              <Upload size={32} style={{ color: 'var(--primary)' }} />
              <div>
                <strong>Click to choose file</strong> or drag and drop
                <p style={{ fontSize: '0.75rem', color: 'var(--text-muted)', marginTop: '4px' }}>Only .csv files supported</p>
              </div>
              <input type="file" accept=".csv" onChange={handleCompaniesCSVSelect} />
            </label>

            {companiesFile && (
              <div style={{ display: 'flex', alignItems: 'center', gap: '8px', background: 'rgba(255,255,255,0.05)', padding: '10px 14px', borderRadius: '8px', fontSize: '0.8rem' }}>
                <FileText size={16} style={{ color: 'var(--primary)' }} />
                <span style={{ flex: 1, fontWeight: 600 }}>{companiesFile.name}</span>
                <span style={{ color: 'var(--text-muted)' }}>{(companiesFile.size / 1024).toFixed(1)} KB</span>
              </div>
            )}

            {parsedCompaniesPreview.length > 0 && (
              <div>
                <span style={{ fontSize: '0.8rem', fontWeight: 700, color: 'var(--text-secondary)', display: 'block', marginBottom: '8px' }}>
                  Preview (First 5 Rows)
                </span>
                <div className="csv-preview-table-container">
                  <table className="csv-preview-table">
                    <thead>
                      <tr>
                        {Object.keys(parsedCompaniesPreview[0]).map(key => <th key={key}>{key}</th>)}
                      </tr>
                    </thead>
                    <tbody>
                      {parsedCompaniesPreview.map((row, idx) => (
                        <tr key={idx}>
                          {Object.values(row).map((val, i) => <td key={i}>{val}</td>)}
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>
            )}

            <button 
              className="btn btn-primary" 
              style={{ justifyContent: 'center' }}
              disabled={!companiesFile}
              onClick={submitCompaniesCSV}
            >
              Upload & Import Data
            </button>
          </div>
        </div>
      )}

      {/* ==========================================
          IMPORT QUESTIONS MODAL
          ========================================== */}
      {showImportQuestions && (
        <div className="modal-backdrop">
          <div className="glass-panel modal-content animate-fade-in">
            <div className="modal-header">
              <h2>Import Interview Questions CSV</h2>
              <button className="modal-close" onClick={() => { setShowImportQuestions(false); setQuestionsFile(null); setParsedQuestionsPreview([]); }}>
                <X size={20} />
              </button>
            </div>

            <div className="csv-template-info">
              💡 <strong>Expected CSV headers:</strong> <code>company_name</code> (or <code>company</code>), <code>role</code>, <code>question_text</code> (or <code>question</code>), <code>category</code> (DSA, OOP, System Design, HR, Resume).
            </div>

            <label className="csv-dropzone">
              <Upload size={32} style={{ color: 'var(--primary)' }} />
              <div>
                <strong>Click to choose file</strong> or drag and drop
                <p style={{ fontSize: '0.75rem', color: 'var(--text-muted)', marginTop: '4px' }}>Only .csv files supported</p>
              </div>
              <input type="file" accept=".csv" onChange={handleQuestionsCSVSelect} />
            </label>

            {questionsFile && (
              <div style={{ display: 'flex', alignItems: 'center', gap: '8px', background: 'rgba(255,255,255,0.05)', padding: '10px 14px', borderRadius: '8px', fontSize: '0.8rem' }}>
                <FileText size={16} />
                <span style={{ flex: 1, fontWeight: 600 }}>{questionsFile.name}</span>
                <span style={{ color: 'var(--text-muted)' }}>{(questionsFile.size / 1024).toFixed(1)} KB</span>
              </div>
            )}

            {parsedQuestionsPreview.length > 0 && (
              <div>
                <span style={{ fontSize: '0.8rem', fontWeight: 700, color: 'var(--text-secondary)', display: 'block', marginBottom: '8px' }}>
                  Preview (First 5 Rows)
                </span>
                <div className="csv-preview-table-container">
                  <table className="csv-preview-table">
                    <thead>
                      <tr>
                        {Object.keys(parsedQuestionsPreview[0]).map(key => <th key={key}>{key}</th>)}
                      </tr>
                    </thead>
                    <tbody>
                      {parsedQuestionsPreview.map((row, idx) => (
                        <tr key={idx}>
                          {Object.values(row).map((val, i) => <td key={i}>{val}</td>)}
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>
            )}

            <button 
              className="btn btn-primary" 
              style={{ justifyContent: 'center' }}
              disabled={!questionsFile}
              onClick={submitQuestionsCSV}
            >
              Upload & Import Data
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

export default App;
