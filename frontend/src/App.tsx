import React, { useState, useEffect, useMemo } from 'react';
import {
  ShieldCheck,
  LayoutDashboard,
  Files,
  Share2,
  History,
  Search,
  FileText,
  Download,
  AlertCircle,
  CheckCircle,
  RefreshCw,
  LogOut,
  Users,
  X,
  Upload,
  Lock,
  ArrowRight,
  Shield,
  Settings as SettingsIcon,
  Trash2,
  Eye,
  EyeOff,
  Grid,
  List,
  Folder,
  HardDrive,
  ChevronRight,
  Menu,
  Key,
  AlertTriangle,
  Info,
  FileSpreadsheet,
  FileCode,
  FileCheck2,
} from 'lucide-react';
import {
  api,
  type User,
  type DocumentItem,
  type ShareItem,
  type AuditLogItem,
  type AdminUser,
  type AdminStats,
  type RecipientUser,
  type UserRole,
} from './api';

interface Toast {
  id: string;
  type: 'success' | 'error' | 'info';
  message: string;
}

export default function App() {
  // Authentication & Session State
  const [user, setUser] = useState<User | null>(null);
  const [loadingSession, setLoadingSession] = useState(true);
  const [authMode, setAuthMode] = useState<'login' | 'register'>('login');
  const [selectedRoleTarget, setSelectedRoleTarget] = useState<UserRole>('DOCUMENT_OWNER');
  const [authEmail, setAuthEmail] = useState('owner@trustvault.local');
  const [authPassword, setAuthPassword] = useState('TrustVaultDemo@2026!');
  const [regName, setRegName] = useState('');
  const [regConfirmPassword, setRegConfirmPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [authError, setAuthError] = useState('');
  const [authNotice, setAuthNotice] = useState('');
  const [authSubmitting, setAuthSubmitting] = useState(false);

  // Health check state
  const [healthStatus, setHealthStatus] = useState<{ status: string; database_configured: boolean; storage_configured: boolean } | null>(null);

  // Navigation State
  const [activeTab, setActiveTab] = useState<string>('owner-overview');
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const [viewMode, setViewMode] = useState<'list' | 'grid'>('list');
  const [sortBy, setSortBy] = useState<'date-desc' | 'date-asc' | 'name-asc' | 'size-desc'>('date-desc');

  // Business Data
  const [documents, setDocuments] = useState<DocumentItem[]>([]);
  const [auditLogs, setAuditLogs] = useState<AuditLogItem[]>([]);
  const [adminUsers, setAdminUsers] = useState<AdminUser[]>([]);
  const [adminStats, setAdminStats] = useState<AdminStats | null>(null);
  const [availableRecipients, setAvailableRecipients] = useState<RecipientUser[]>([]);

  // Filtering & Search
  const [searchQuery, setSearchQuery] = useState('');
  const [categoryFilter, setCategoryFilter] = useState('all');
  const [auditFilter, setAuditFilter] = useState('');
  const [loadingData, setLoadingData] = useState(false);

  // Toast Notifications
  const [toasts, setToasts] = useState<Toast[]>([]);

  function addToast(type: 'success' | 'error' | 'info', message: string) {
    const id = Math.random().toString(36).substring(2, 9);
    setToasts((prev) => [...prev, { id, type, message }]);
    setTimeout(() => {
      setToasts((prev) => prev.filter((t) => t.id !== id));
    }, 4500);
  }

  // Modals & Action States
  const [uploadFile, setUploadFile] = useState<File | null>(null);
  const [uploading, setUploading] = useState(false);

  const [shareModalDoc, setShareModalDoc] = useState<DocumentItem | null>(null);
  const [docShares, setDocShares] = useState<ShareItem[]>([]);
  const [recipientEmail, setRecipientEmail] = useState('');
  const [loadingShares, setLoadingShares] = useState(false);
  const [sharingSubmitting, setSharingSubmitting] = useState(false);
  const [shareEmailStatus, setShareEmailStatus] = useState<string | null>(null);

  const [settingsModalOpen, setSettingsModalOpen] = useState(false);
  const [inspectDoc, setInspectDoc] = useState<DocumentItem | null>(null);
  const [deleteConfirmDoc, setDeleteConfirmDoc] = useState<DocumentItem | null>(null);
  const [deletingDoc, setDeletingDoc] = useState(false);
  const [revokeConfirmShare, setRevokeConfirmShare] = useState<{ docId: string; shareId: string; recipientEmail: string } | null>(null);
  const [revokingShare, setRevokingShare] = useState(false);
  const [roleChangeTarget, setRoleChangeTarget] = useState<AdminUser | null>(null);
  const [selectedNewRole, setSelectedNewRole] = useState<UserRole>('VIEWER');
  const [updatingRole, setUpdatingRole] = useState(false);

  // 1. Initial Load & Session Verification
  useEffect(() => {
    checkHealth();
    verifyAuth();
  }, []);

  async function checkHealth() {
    try {
      const res = await api.health.check();
      setHealthStatus(res);
    } catch {
      setHealthStatus({ status: 'offline', database_configured: false, storage_configured: false });
    }
  }

  async function verifyAuth() {
    try {
      setLoadingSession(true);
      const res = await api.auth.getMe();
      setUser(res.user);
      routeToDefaultTab(res.user.role);
    } catch {
      setUser(null);
    } finally {
      setLoadingSession(false);
    }
  }

  function routeToDefaultTab(role: UserRole) {
    if (role === 'ADMIN') {
      setActiveTab('admin-overview');
    } else if (role === 'VIEWER') {
      setActiveTab('viewer-overview');
    } else {
      setActiveTab('owner-overview');
    }
  }

  // Refresh data when user or active tab changes
  useEffect(() => {
    if (!user) return;
    refreshData();
  }, [user, activeTab]);

  async function refreshData() {
    if (!user) return;
    setLoadingData(true);
    try {
      // 1. Always load documents accessible to current role
      const docs = await api.documents.list();
      setDocuments(docs);

      // 2. Load audit logs for tabs that display audit info
      if (
        activeTab === 'admin-overview' ||
        activeTab === 'admin-audit' ||
        activeTab === 'admin-shares' ||
        activeTab === 'admin-security' ||
        activeTab === 'owner-activity' ||
        activeTab === 'viewer-activity'
      ) {
        const logs = await api.audit.list(200);
        setAuditLogs(logs);
      }

      // 3. Load admin stats & users if admin
      if (user.role === 'ADMIN') {
        const stats = await api.admin.getStats();
        setAdminStats(stats);
        if (activeTab === 'admin-users') {
          const users = await api.admin.listUsers();
          setAdminUsers(users);
        }
      }

      // 4. Load recipients list for owner & admin
      if (user.role === 'DOCUMENT_OWNER' || user.role === 'ADMIN') {
        loadRecipients();
      }
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : 'Failed to load vault data';
      addToast('error', msg);
    } finally {
      setLoadingData(false);
    }
  }

  async function loadRecipients() {
    try {
      const list = await api.documents.listRecipients();
      setAvailableRecipients(list);
    } catch {
      // Ignored
    }
  }

  // Authentication Handlers
  async function handleLogin(e?: React.FormEvent, customEmail?: string, customPass?: string) {
    if (e) e.preventDefault();
    setAuthError('');
    setAuthNotice('');
    setAuthSubmitting(true);
    const emailToUse = customEmail || authEmail;
    const passToUse = customPass || authPassword;
    try {
      const res = await api.auth.login(emailToUse, passToUse);
      setUser(res.user);
      setAuthPassword('');

      // Check role match: selectedRoleTarget vs actual server role
      if (res.user.role !== selectedRoleTarget) {
        addToast(
          'info',
          `Routed to ${res.user.role} workspace in accordance with Zero-Trust server authorization.`
        );
      } else {
        addToast('success', `Welcome back, ${res.user.email}! Authenticated as ${res.user.role}.`);
      }
      routeToDefaultTab(res.user.role);
      checkHealth();
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : 'Invalid credentials. Please verify your email and password.';
      setAuthError(msg);
      addToast('error', msg);
    } finally {
      setAuthSubmitting(false);
    }
  }

  async function handleRegister(e: React.FormEvent) {
    e.preventDefault();
    setAuthError('');
    setAuthNotice('');

    if (authPassword.length < 8) {
      setAuthError('Password must be at least 8 characters in length.');
      return;
    }
    if (authPassword !== regConfirmPassword) {
      setAuthError('Password and confirmation do not match.');
      return;
    }

    setAuthSubmitting(true);
    try {
      await api.auth.register(authEmail, authPassword);
      addToast('success', 'Account created successfully! Signing in with Viewer privileges...');
      const loginRes = await api.auth.login(authEmail, authPassword);
      setUser(loginRes.user);
      setAuthPassword('');
      setRegConfirmPassword('');
      setRegName('');
      routeToDefaultTab(loginRes.user.role);
      checkHealth();
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : 'Registration failed. Email may already be registered.';
      setAuthError(msg);
      addToast('error', msg);
    } finally {
      setAuthSubmitting(false);
    }
  }

  async function handleLogout() {
    try {
      await api.auth.logout();
      addToast('info', 'You have been securely signed out of your session.');
    } catch {
      // Ignored
    } finally {
      setUser(null);
      setDocuments([]);
      setAuditLogs([]);
      setAdminUsers([]);
      setAdminStats(null);
      setAuthNotice('');
      checkHealth();
    }
  }

  // Quick Role Card Selector on Login Screen
  function selectRolePreset(role: UserRole) {
    setSelectedRoleTarget(role);
    setAuthNotice('');
    setAuthError('');
    if (role === 'ADMIN') {
      setAuthEmail('admin@trustvault.local');
      setAuthPassword('TrustVaultDemo@2026!');
    } else if (role === 'DOCUMENT_OWNER') {
      setAuthEmail('owner@trustvault.local');
      setAuthPassword('TrustVaultDemo@2026!');
    } else {
      setAuthEmail('viewer@trustvault.local');
      setAuthPassword('TrustVaultDemo@2026!');
    }
  }

  // Document Operations
  async function handleUpload(e: React.FormEvent) {
    e.preventDefault();
    if (!uploadFile) return;

    setUploading(true);
    try {
      const newDoc = await api.documents.upload(uploadFile);
      setDocuments((prev) => [newDoc, ...prev]);
      setUploadFile(null);
      addToast('success', `"${newDoc.original_filename}" stored with unpredictable 48-char hex key.`);
      setActiveTab('owner-documents');
      refreshData();
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : 'Upload rejected by security validation.';
      addToast('error', msg);
    } finally {
      setUploading(false);
    }
  }

  async function handleDownload(doc: DocumentItem) {
    try {
      addToast('info', `Streaming "${doc.original_filename}" from secure storage...`);
      await api.documents.download(doc.id, doc.original_filename);
      addToast('success', `Downloaded "${doc.original_filename}". Integrity verified.`);
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : 'Download failed: Access denied or revoked.';
      addToast('error', msg);
    }
  }

  async function handleDeleteDocument() {
    if (!deleteConfirmDoc) return;
    setDeletingDoc(true);
    try {
      await api.documents.delete(deleteConfirmDoc.id);
      setDocuments((prev) => prev.filter((d) => d.id !== deleteConfirmDoc.id));
      addToast('success', `Document "${deleteConfirmDoc.original_filename}" and all active shares permanently deleted.`);
      setDeleteConfirmDoc(null);
      refreshData();
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : 'Delete operation failed';
      addToast('error', msg);
    } finally {
      setDeletingDoc(false);
    }
  }

  // Sharing & Revocation Operations
  async function openShareModal(doc: DocumentItem) {
    setShareModalDoc(doc);
    setRecipientEmail('');
    setShareEmailStatus(null);
    setLoadingShares(true);
    try {
      const shares = await api.documents.listShares(doc.id);
      setDocShares(shares);
      await loadRecipients();
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : 'Failed to retrieve active shares';
      addToast('error', msg);
    } finally {
      setLoadingShares(false);
    }
  }

  async function handleCreateShare(e?: React.FormEvent, directEmail?: string) {
    if (e) e.preventDefault();
    if (!shareModalDoc) return;
    const targetEmail = directEmail || recipientEmail;
    if (!targetEmail) return;

    setSharingSubmitting(true);
    setShareEmailStatus(null);
    try {
      const newShare = await api.documents.createShare(shareModalDoc.id, targetEmail.trim().toLowerCase());
      setDocShares((prev) => [newShare, ...prev]);
      setRecipientEmail('');
      if (newShare.email_notification_note) {
        setShareEmailStatus(newShare.email_notification_note);
      }
      addToast('success', `Vault access granted for ${targetEmail}.`);
      refreshData();
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : 'Failed to grant share permission';
      addToast('error', msg);
    } finally {
      setSharingSubmitting(false);
    }
  }

  async function handleRevokeShare() {
    if (!revokeConfirmShare) return;
    setRevokingShare(true);
    try {
      await api.documents.revokeShare(revokeConfirmShare.docId, revokeConfirmShare.shareId);
      setDocShares((prev) =>
        prev.map((s) => (s.id === revokeConfirmShare.shareId ? { ...s, is_active: false, revoked_at: new Date().toISOString() } : s))
      );
      addToast('success', `Access revoked for "${revokeConfirmShare.recipientEmail}". Next request returns 403 Forbidden.`);
      setRevokeConfirmShare(null);
      refreshData();
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : 'Failed to revoke access';
      addToast('error', msg);
    } finally {
      setRevokingShare(false);
    }
  }

  // Admin User Role Update
  async function handleUpdateRole() {
    if (!roleChangeTarget) return;
    setUpdatingRole(true);
    try {
      const updated = await api.admin.updateRole(roleChangeTarget.id, selectedNewRole);
      setAdminUsers((prev) => prev.map((u) => (u.id === updated.id ? updated : u)));
      addToast('success', `Role for "${updated.email}" updated to ${updated.role}.`);
      setRoleChangeTarget(null);
      refreshData();
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : 'Failed to update user role';
      addToast('error', msg);
    } finally {
      setUpdatingRole(false);
    }
  }

  // Filtered & Sorted Documents
  const filteredDocuments = useMemo(() => {
    const list = documents.filter((doc) => {
      const matchQuery =
        doc.original_filename.toLowerCase().includes(searchQuery.toLowerCase()) ||
        (doc.owner_email && doc.owner_email.toLowerCase().includes(searchQuery.toLowerCase()));

      if (!matchQuery) return false;

      if (categoryFilter === 'all') return true;
      if (categoryFilter === 'pdf') return doc.content_type.includes('pdf');
      if (categoryFilter === 'image') return doc.content_type.includes('image');
      if (categoryFilter === 'office')
        return (
          doc.content_type.includes('word') ||
          doc.content_type.includes('officedocument') ||
          doc.content_type.includes('sheet') ||
          doc.content_type.includes('excel')
        );
      if (categoryFilter === 'text') return doc.content_type.includes('text');
      return true;
    });

    return list.sort((a, b) => {
      if (sortBy === 'date-desc') return new Date(b.created_at).getTime() - new Date(a.created_at).getTime();
      if (sortBy === 'date-asc') return new Date(a.created_at).getTime() - new Date(b.created_at).getTime();
      if (sortBy === 'name-asc') return a.original_filename.localeCompare(b.original_filename);
      if (sortBy === 'size-desc') return b.size_bytes - a.size_bytes;
      return 0;
    });
  }, [documents, searchQuery, categoryFilter, sortBy]);

  // Filtered Audit Logs
  const filteredAuditLogs = useMemo(() => {
    return auditLogs.filter((log) => {
      const matchQuery =
        log.action.toLowerCase().includes(searchQuery.toLowerCase()) ||
        log.actor_id.toLowerCase().includes(searchQuery.toLowerCase()) ||
        (log.document_id && log.document_id.toLowerCase().includes(searchQuery.toLowerCase()));

      if (!matchQuery) return false;
      if (!auditFilter) return true;
      return log.action === auditFilter;
    });
  }, [auditLogs, searchQuery, auditFilter]);

  // Helper formatting
  function formatBytes(bytes: number) {
    if (bytes === 0) return '0 B';
    const k = 1024;
    const sizes = ['B', 'KB', 'MB', 'GB'];
    const i = Math.floor(Math.log(bytes) / Math.log(k));
    return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + ' ' + sizes[i];
  }

  function formatDate(isoString: string) {
    try {
      const d = new Date(isoString);
      return d.toLocaleDateString(undefined, {
        month: 'short',
        day: 'numeric',
        year: 'numeric',
        hour: '2-digit',
        minute: '2-digit',
      });
    } catch {
      return isoString;
    }
  }

  function getFileIcon(contentType: string) {
    if (contentType.includes('pdf')) return <FileText className="w-5 h-5 text-red-400" />;
    if (contentType.includes('sheet') || contentType.includes('excel')) return <FileSpreadsheet className="w-5 h-5 text-emerald-400" />;
    if (contentType.includes('word') || contentType.includes('officedocument')) return <FileText className="w-5 h-5 text-blue-400" />;
    if (contentType.includes('image')) return <FileCheck2 className="w-5 h-5 text-purple-400" />;
    return <FileCode className="w-5 h-5 text-amber-400" />;
  }

  // Calculate volume used
  const totalVolumeBytes = documents.reduce((acc, d) => acc + d.size_bytes, 0);
  const quotaBytes = 100 * 1024 * 1024; // 100 MB quota
  const storagePercentage = Math.min(100, Math.round((totalVolumeBytes / quotaBytes) * 100));

  // -------------------------------------------------------------
  // RENDER: Loading session skeleton
  // -------------------------------------------------------------
  if (loadingSession) {
    return (
      <div className="min-h-screen bg-[#070b12] flex flex-col items-center justify-center text-white">
        <div className="flex items-center gap-3 mb-4">
          <div className="p-3 bg-gradient-to-tr from-cyan-600 to-blue-600 rounded-2xl shadow-xl ring-1 ring-cyan-400/30">
            <ShieldCheck className="w-8 h-8 text-white animate-pulse" />
          </div>
          <div>
            <span className="text-2xl font-black tracking-tight">TrustVault</span>
            <span className="block text-[10px] tracking-widest uppercase text-cyan-400 font-bold">Enterprise Edition</span>
          </div>
        </div>
        <div className="flex items-center gap-2 px-4 py-2 bg-slate-900/80 rounded-full border border-slate-800 text-xs text-slate-400">
          <RefreshCw className="w-3.5 h-3.5 animate-spin text-cyan-400" />
          <span>Verifying cryptographic session signature...</span>
        </div>
      </div>
    );
  }

  // -------------------------------------------------------------
  // RENDER: Authentication Screen (Login / Register)
  // -------------------------------------------------------------
  if (!user) {
    return (
      <div className="min-h-screen bg-[#070b12] text-slate-100 flex flex-col justify-center py-12 sm:px-6 lg:px-8 relative overflow-hidden">
        {/* Subtle Background Glows */}
        <div className="absolute top-0 left-1/4 w-[500px] h-[500px] bg-cyan-600/10 rounded-full blur-[140px] pointer-events-none" />
        <div className="absolute bottom-0 right-1/4 w-[500px] h-[500px] bg-blue-600/10 rounded-full blur-[140px] pointer-events-none" />

        <div className="sm:mx-auto sm:w-full sm:max-w-md text-center z-10">
          <div className="inline-flex items-center justify-center p-3.5 bg-gradient-to-tr from-cyan-600 to-blue-600 rounded-2xl shadow-2xl shadow-cyan-900/30 mb-4 ring-1 ring-cyan-400/30">
            <ShieldCheck className="w-10 h-10 text-white" />
          </div>
          <h1 className="text-3xl font-extrabold tracking-tight text-white flex items-center justify-center gap-2">
            TrustVault
            <span className="text-[10px] uppercase font-bold tracking-widest px-2 py-0.5 rounded-full bg-cyan-950 text-cyan-300 border border-cyan-800/80">
              Zero-Trust
            </span>
          </h1>
          <p className="mt-1.5 text-sm text-slate-400">Enterprise Secure Document Sharing & Cryptographic Audit Trail</p>
        </div>

        <div className="mt-8 sm:mx-auto sm:w-full sm:max-w-xl z-10 px-4">
          <div className="bg-slate-900/80 backdrop-blur-xl border border-slate-800/80 py-8 px-6 sm:px-10 shadow-2xl rounded-2xl">
            {authMode === 'login' ? (
              <>
                {/* Role Target Selector Cards */}
                <div className="mb-6">
                  <div className="flex items-center justify-between mb-2">
                    <label className="text-[11px] font-bold text-slate-400 uppercase tracking-wider">
                      Select Target Role Portal
                    </label>
                    <span className="text-[10px] text-cyan-400 font-mono">1-Click Fast Switch</span>
                  </div>
                  <div className="grid grid-cols-3 gap-3">
                    <button
                      type="button"
                      onClick={() => selectRolePreset('ADMIN')}
                      className={`p-3.5 rounded-xl border text-left transition-all ${
                        selectedRoleTarget === 'ADMIN'
                          ? 'bg-purple-950/50 border-purple-500/80 text-purple-300 ring-2 ring-purple-500/30 shadow-lg shadow-purple-950/50'
                          : 'bg-slate-950/60 border-slate-800 text-slate-400 hover:border-slate-700'
                      }`}
                    >
                      <div className="flex items-center justify-between mb-1">
                        <span className="text-xs font-bold uppercase tracking-wider">Admin</span>
                        <Shield className="w-3.5 h-3.5" />
                      </div>
                      <p className="text-[10px] text-slate-400 line-clamp-2">Governance & Audits</p>
                    </button>

                    <button
                      type="button"
                      onClick={() => selectRolePreset('DOCUMENT_OWNER')}
                      className={`p-3.5 rounded-xl border text-left transition-all ${
                        selectedRoleTarget === 'DOCUMENT_OWNER'
                          ? 'bg-cyan-950/50 border-cyan-500/80 text-cyan-300 ring-2 ring-cyan-500/30 shadow-lg shadow-cyan-950/50'
                          : 'bg-slate-950/60 border-slate-800 text-slate-400 hover:border-slate-700'
                      }`}
                    >
                      <div className="flex items-center justify-between mb-1">
                        <span className="text-xs font-bold uppercase tracking-wider">Owner</span>
                        <Folder className="w-3.5 h-3.5" />
                      </div>
                      <p className="text-[10px] text-slate-400 line-clamp-2">Manage Vault & Share</p>
                    </button>

                    <button
                      type="button"
                      onClick={() => selectRolePreset('VIEWER')}
                      className={`p-3.5 rounded-xl border text-left transition-all ${
                        selectedRoleTarget === 'VIEWER'
                          ? 'bg-emerald-950/50 border-emerald-500/80 text-emerald-300 ring-2 ring-emerald-500/30 shadow-lg shadow-emerald-950/50'
                          : 'bg-slate-950/60 border-slate-800 text-slate-400 hover:border-slate-700'
                      }`}
                    >
                      <div className="flex items-center justify-between mb-1">
                        <span className="text-xs font-bold uppercase tracking-wider">Viewer</span>
                        <Eye className="w-3.5 h-3.5" />
                      </div>
                      <p className="text-[10px] text-slate-400 line-clamp-2">Recipient Access</p>
                    </button>
                  </div>
                  <p className="text-[11px] text-slate-400 mt-2.5 flex items-center gap-1.5">
                    <Info className="w-3.5 h-3.5 text-slate-400 shrink-0" />
                    Role selection selects default credentials. Access is strictly determined by server-verified credentials.
                  </p>
                </div>

                {/* Login Form */}
                <form onSubmit={handleLogin} className="space-y-4">
                  {authError && (
                    <div className="p-3 bg-red-950/60 border border-red-500/50 rounded-xl text-red-300 text-xs flex items-start gap-2 shadow-inner">
                      <AlertCircle className="w-4 h-4 text-red-400 shrink-0 mt-0.5" />
                      <span>{authError}</span>
                    </div>
                  )}

                  {authNotice && (
                    <div className="p-3 bg-amber-950/60 border border-amber-500/50 rounded-xl text-amber-200 text-xs flex items-start gap-2">
                      <AlertTriangle className="w-4 h-4 text-amber-400 shrink-0 mt-0.5" />
                      <span>{authNotice}</span>
                    </div>
                  )}

                  <div>
                    <label className="block text-xs font-semibold text-slate-300 mb-1">Email Address</label>
                    <input
                      type="email"
                      required
                      value={authEmail}
                      onChange={(e) => setAuthEmail(e.target.value)}
                      className="w-full px-3.5 py-2.5 bg-slate-950 border border-slate-700/80 rounded-xl text-white text-sm focus:outline-none focus:ring-2 focus:ring-cyan-500 focus:border-cyan-500 transition-all placeholder-slate-500 font-mono"
                      placeholder="user@trustvault.local"
                    />
                  </div>

                  <div>
                    <label className="block text-xs font-semibold text-slate-300 mb-1">Password</label>
                    <div className="relative">
                      <input
                        type={showPassword ? 'text' : 'password'}
                        required
                        value={authPassword}
                        onChange={(e) => setAuthPassword(e.target.value)}
                        className="w-full px-3.5 py-2.5 bg-slate-950 border border-slate-700/80 rounded-xl text-white text-sm focus:outline-none focus:ring-2 focus:ring-cyan-500 focus:border-cyan-500 transition-all pr-10 placeholder-slate-500 font-mono"
                        placeholder="••••••••••••"
                      />
                      <button
                        type="button"
                        onClick={() => setShowPassword(!showPassword)}
                        className="absolute right-3 top-1/2 -translate-y-1/2 text-slate-400 hover:text-white transition-colors"
                      >
                        {showPassword ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                      </button>
                    </div>
                  </div>

                  <button
                    type="submit"
                    disabled={authSubmitting}
                    className="w-full mt-2 py-3 px-4 bg-gradient-to-r from-cyan-600 to-blue-600 hover:from-cyan-500 hover:to-blue-500 text-white font-bold rounded-xl text-sm shadow-xl shadow-cyan-950/50 flex items-center justify-center gap-2 transition-all disabled:opacity-50"
                  >
                    {authSubmitting ? (
                      <>
                        <RefreshCw className="w-4 h-4 animate-spin" /> Verifying Server Authorization...
                      </>
                    ) : (
                      <>
                        Sign In to Vault <ArrowRight className="w-4 h-4" />
                      </>
                    )}
                  </button>
                </form>

                <div className="mt-6 pt-6 border-t border-slate-800 text-center">
                  <p className="text-xs text-slate-400">
                    Need a new vault account?{' '}
                    <button
                      type="button"
                      onClick={() => {
                        setAuthMode('register');
                        setAuthError('');
                        setAuthNotice('');
                      }}
                      className="text-cyan-400 hover:text-cyan-300 font-bold ml-1"
                    >
                      Create Account (Viewer Role)
                    </button>
                  </p>
                </div>
              </>
            ) : (
              /* Register Form */
              <>
                <div className="mb-6">
                  <h2 className="text-lg font-bold text-white mb-1">Create TrustVault Account</h2>
                  <p className="text-xs text-slate-400">
                    Public registrations are automatically provisioned with least-privileged{' '}
                    <span className="text-emerald-400 font-bold">VIEWER</span> status.
                  </p>
                </div>

                <form onSubmit={handleRegister} className="space-y-4">
                  {authError && (
                    <div className="p-3 bg-red-950/60 border border-red-500/50 rounded-xl text-red-300 text-xs flex items-start gap-2 shadow-inner">
                      <AlertCircle className="w-4 h-4 text-red-400 shrink-0 mt-0.5" />
                      <span>{authError}</span>
                    </div>
                  )}

                  <div>
                    <label className="block text-xs font-semibold text-slate-300 mb-1">Full Name</label>
                    <input
                      type="text"
                      value={regName}
                      onChange={(e) => setRegName(e.target.value)}
                      className="w-full px-3.5 py-2.5 bg-slate-950 border border-slate-700/80 rounded-xl text-white text-sm focus:outline-none focus:ring-2 focus:ring-cyan-500 focus:border-cyan-500 transition-all placeholder-slate-500"
                      placeholder="Jane Doe"
                    />
                  </div>

                  <div>
                    <label className="block text-xs font-semibold text-slate-300 mb-1">Email Address</label>
                    <input
                      type="email"
                      required
                      value={authEmail}
                      onChange={(e) => setAuthEmail(e.target.value)}
                      className="w-full px-3.5 py-2.5 bg-slate-950 border border-slate-700/80 rounded-xl text-white text-sm focus:outline-none focus:ring-2 focus:ring-cyan-500 focus:border-cyan-500 transition-all placeholder-slate-500 font-mono"
                      placeholder="user@example.com"
                    />
                  </div>

                  <div>
                    <label className="block text-xs font-semibold text-slate-300 mb-1">Password</label>
                    <div className="relative">
                      <input
                        type={showPassword ? 'text' : 'password'}
                        required
                        value={authPassword}
                        onChange={(e) => setAuthPassword(e.target.value)}
                        className="w-full px-3.5 py-2.5 bg-slate-950 border border-slate-700/80 rounded-xl text-white text-sm focus:outline-none focus:ring-2 focus:ring-cyan-500 focus:border-cyan-500 transition-all pr-10 placeholder-slate-500 font-mono"
                        placeholder="Minimum 8 characters"
                      />
                      <button
                        type="button"
                        onClick={() => setShowPassword(!showPassword)}
                        className="absolute right-3 top-1/2 -translate-y-1/2 text-slate-400 hover:text-white"
                      >
                        {showPassword ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                      </button>
                    </div>
                  </div>

                  <div>
                    <label className="block text-xs font-semibold text-slate-300 mb-1">Confirm Password</label>
                    <input
                      type={showPassword ? 'text' : 'password'}
                      required
                      value={regConfirmPassword}
                      onChange={(e) => setRegConfirmPassword(e.target.value)}
                      className="w-full px-3.5 py-2.5 bg-slate-950 border border-slate-700/80 rounded-xl text-white text-sm focus:outline-none focus:ring-2 focus:ring-cyan-500 focus:border-cyan-500 transition-all placeholder-slate-500 font-mono"
                      placeholder="Re-enter password"
                    />
                  </div>

                  <div className="p-3 bg-slate-950/80 border border-slate-800 rounded-xl text-[11px] text-slate-400">
                    <p className="font-semibold text-slate-300 mb-0.5">Argon2id Enforcement:</p>
                    <p>All passwords hashed with Argon2id. Client-supplied administrative roles are rejected.</p>
                  </div>

                  <button
                    type="submit"
                    disabled={authSubmitting}
                    className="w-full mt-2 py-3 px-4 bg-gradient-to-r from-cyan-600 to-blue-600 hover:from-cyan-500 hover:to-blue-500 text-white font-bold rounded-xl text-sm shadow-xl shadow-cyan-950/50 flex items-center justify-center gap-2 transition-all disabled:opacity-50"
                  >
                    {authSubmitting ? (
                      <>
                        <RefreshCw className="w-4 h-4 animate-spin" /> Provisioning Account...
                      </>
                    ) : (
                      <>
                        Create Account <ArrowRight className="w-4 h-4" />
                      </>
                    )}
                  </button>
                </form>

                <div className="mt-6 pt-6 border-t border-slate-800 text-center">
                  <p className="text-xs text-slate-400">
                    Already have an account?{' '}
                    <button
                      type="button"
                      onClick={() => {
                        setAuthMode('login');
                        setAuthError('');
                        setAuthNotice('');
                      }}
                      className="text-cyan-400 hover:text-cyan-300 font-bold ml-1"
                    >
                      Sign In
                    </button>
                  </p>
                </div>
              </>
            )}
          </div>

          {/* Security Banner Footer */}
          <div className="mt-6 text-center text-xs text-slate-400 flex items-center justify-center gap-2">
            <Lock className="w-3.5 h-3.5 text-cyan-400" />
            <span>Zero-Trust Architecture: HMAC-SHA256 Sessions • CSRF Protection • Argon2id</span>
          </div>
        </div>
      </div>
    );
  }

  // -------------------------------------------------------------
  // RENDER: Authenticated Enterprise Layout
  // -------------------------------------------------------------
  return (
    <div className="min-h-screen bg-[#070b12] text-slate-100 flex flex-col md:flex-row antialiased selection:bg-cyan-500 selection:text-white">
      {/* Toast Notification Container */}
      <div className="fixed bottom-5 right-5 z-50 flex flex-col gap-2 max-w-sm w-full pointer-events-none">
        {toasts.map((t) => (
          <div
            key={t.id}
            className={`p-3.5 rounded-xl border shadow-2xl backdrop-blur-md pointer-events-auto transition-all flex items-start gap-3 text-xs ${
              t.type === 'success'
                ? 'bg-emerald-950/90 border-emerald-500/60 text-emerald-200'
                : t.type === 'error'
                ? 'bg-red-950/90 border-red-500/60 text-red-200'
                : 'bg-cyan-950/90 border-cyan-500/60 text-cyan-200'
            }`}
          >
            {t.type === 'success' ? (
              <CheckCircle className="w-4 h-4 text-emerald-400 shrink-0 mt-0.5" />
            ) : t.type === 'error' ? (
              <AlertCircle className="w-4 h-4 text-red-400 shrink-0 mt-0.5" />
            ) : (
              <Info className="w-4 h-4 text-cyan-400 shrink-0 mt-0.5" />
            )}
            <div className="flex-1 font-medium">{t.message}</div>
          </div>
        ))}
      </div>

      {/* Mobile Top Bar */}
      <div className="md:hidden flex items-center justify-between p-4 bg-slate-900 border-b border-slate-800 z-30">
        <div className="flex items-center gap-2">
          <ShieldCheck className="w-6 h-6 text-cyan-400" />
          <span className="font-bold text-lg text-white">TrustVault</span>
        </div>
        <button
          onClick={() => setSidebarOpen(!sidebarOpen)}
          className="p-2 text-slate-400 hover:text-white rounded-lg hover:bg-slate-800"
        >
          {sidebarOpen ? <X className="w-5 h-5" /> : <Menu className="w-5 h-5" />}
        </button>
      </div>

      {/* FIXED ENTERPRISE SIDEBAR */}
      <aside
        className={`fixed md:sticky top-0 inset-y-0 left-0 z-40 w-64 bg-[#0a0f18] border-r border-slate-800/80 flex flex-col justify-between transition-transform duration-200 ease-in-out md:translate-x-0 ${
          sidebarOpen ? 'translate-x-0' : '-translate-x-full'
        } h-screen`}
      >
        <div className="flex flex-col h-full overflow-y-auto">
          {/* Logo & Brand Header */}
          <div className="p-4 border-b border-slate-800/80 flex items-center justify-between">
            <div className="flex items-center gap-3">
              <div className="p-2 bg-gradient-to-tr from-cyan-600 to-blue-600 rounded-xl shadow-md ring-1 ring-cyan-400/20">
                <ShieldCheck className="w-5 h-5 text-white" />
              </div>
              <div>
                <h2 className="font-black text-sm text-white tracking-tight flex items-center gap-1.5">
                  TrustVault
                  <span className="text-[9px] uppercase tracking-wider px-1.5 py-0.5 rounded bg-cyan-950 text-cyan-400 border border-cyan-800/60">
                    Enterprise
                  </span>
                </h2>
                <div className="flex items-center gap-1.5 mt-0.5">
                  <span className="w-1.5 h-1.5 rounded-full bg-emerald-400 animate-pulse" />
                  <span className="text-[10px] uppercase font-bold tracking-wider text-slate-400">Zero-Trust Core</span>
                </div>
              </div>
            </div>
            <button
              onClick={() => setSidebarOpen(false)}
              className="md:hidden text-slate-400 hover:text-white p-1 rounded"
            >
              <X className="w-5 h-5" />
            </button>
          </div>

          {/* User Profile Pill in Sidebar */}
          <div className="p-3 bg-slate-950/60 border-b border-slate-800/80 flex items-center justify-between">
            <div className="truncate pr-2">
              <p className="text-xs font-semibold text-slate-200 truncate font-mono">{user.email}</p>
              <span
                className={`inline-block mt-0.5 px-2 py-0.5 rounded text-[9px] font-black uppercase tracking-wider ${
                  user.role === 'ADMIN'
                    ? 'bg-purple-950 text-purple-300 border border-purple-800/60'
                    : user.role === 'DOCUMENT_OWNER'
                    ? 'bg-cyan-950 text-cyan-300 border border-cyan-800/60'
                    : 'bg-emerald-950 text-emerald-300 border border-emerald-800/60'
                }`}
              >
                {user.role.replace('_', ' ')}
              </span>
            </div>
            <button
              onClick={() => setSettingsModalOpen(true)}
              title="Vault Security Parameters"
              className="p-1.5 text-slate-400 hover:text-cyan-400 rounded-lg hover:bg-slate-800 transition-colors"
            >
              <SettingsIcon className="w-4 h-4" />
            </button>
          </div>

          {/* ROLE SPECIFIC NAVIGATION ITEMS */}
          <nav className="flex-1 px-3 py-4 space-y-1">
            {/* 1. ADMIN NAVIGATION */}
            {user.role === 'ADMIN' && (
              <>
                <div className="px-3 pb-1 text-[10px] font-bold text-slate-400 uppercase tracking-wider">
                  Admin Governance
                </div>

                <button
                  onClick={() => {
                    setActiveTab('admin-overview');
                    setSidebarOpen(false);
                  }}
                  className={`w-full flex items-center justify-between px-3 py-2 rounded-xl text-xs font-medium transition-all ${
                    activeTab === 'admin-overview'
                      ? 'bg-cyan-500/10 text-cyan-400 border border-cyan-500/30'
                      : 'text-slate-400 hover:text-slate-200 hover:bg-slate-800/50'
                  }`}
                >
                  <div className="flex items-center gap-2.5">
                    <LayoutDashboard className="w-4 h-4" />
                    <span>Overview</span>
                  </div>
                </button>

                <button
                  onClick={() => {
                    setActiveTab('admin-users');
                    setSidebarOpen(false);
                  }}
                  className={`w-full flex items-center justify-between px-3 py-2 rounded-xl text-xs font-medium transition-all ${
                    activeTab === 'admin-users'
                      ? 'bg-cyan-500/10 text-cyan-400 border border-cyan-500/30'
                      : 'text-slate-400 hover:text-slate-200 hover:bg-slate-800/50'
                  }`}
                >
                  <div className="flex items-center gap-2.5">
                    <Users className="w-4 h-4" />
                    <span>User Management</span>
                  </div>
                  {adminUsers.length > 0 && (
                    <span className="px-1.5 py-0.5 rounded text-[10px] font-mono bg-slate-800 text-slate-300">
                      {adminUsers.length}
                    </span>
                  )}
                </button>

                <button
                  onClick={() => {
                    setActiveTab('admin-documents');
                    setSidebarOpen(false);
                  }}
                  className={`w-full flex items-center justify-between px-3 py-2 rounded-xl text-xs font-medium transition-all ${
                    activeTab === 'admin-documents'
                      ? 'bg-cyan-500/10 text-cyan-400 border border-cyan-500/30'
                      : 'text-slate-400 hover:text-slate-200 hover:bg-slate-800/50'
                  }`}
                >
                  <div className="flex items-center gap-2.5">
                    <Files className="w-4 h-4" />
                    <span>All Documents (Meta)</span>
                  </div>
                  <span className="px-1.5 py-0.5 rounded text-[10px] font-mono bg-slate-800 text-slate-300">
                    {documents.length}
                  </span>
                </button>

                <button
                  onClick={() => {
                    setActiveTab('admin-audit');
                    setSidebarOpen(false);
                  }}
                  className={`w-full flex items-center justify-between px-3 py-2 rounded-xl text-xs font-medium transition-all ${
                    activeTab === 'admin-audit'
                      ? 'bg-cyan-500/10 text-cyan-400 border border-cyan-500/30'
                      : 'text-slate-400 hover:text-slate-200 hover:bg-slate-800/50'
                  }`}
                >
                  <div className="flex items-center gap-2.5">
                    <History className="w-4 h-4" />
                    <span>Audit Logs</span>
                  </div>
                  <span className="px-1.5 py-0.5 rounded text-[10px] font-mono bg-slate-800 text-slate-300">
                    {adminStats?.total_audit_events ?? auditLogs.length}
                  </span>
                </button>

                <button
                  onClick={() => {
                    setActiveTab('admin-shares');
                    setSidebarOpen(false);
                  }}
                  className={`w-full flex items-center justify-between px-3 py-2 rounded-xl text-xs font-medium transition-all ${
                    activeTab === 'admin-shares'
                      ? 'bg-cyan-500/10 text-cyan-400 border border-cyan-500/30'
                      : 'text-slate-400 hover:text-slate-200 hover:bg-slate-800/50'
                  }`}
                >
                  <div className="flex items-center gap-2.5">
                    <Share2 className="w-4 h-4" />
                    <span>Permission & Shares</span>
                  </div>
                  <span className="px-1.5 py-0.5 rounded text-[10px] font-mono bg-slate-800 text-slate-300">
                    {adminStats?.active_shares ?? 0}
                  </span>
                </button>

                <button
                  onClick={() => {
                    setActiveTab('admin-security');
                    setSidebarOpen(false);
                  }}
                  className={`w-full flex items-center justify-between px-3 py-2 rounded-xl text-xs font-medium transition-all ${
                    activeTab === 'admin-security'
                      ? 'bg-cyan-500/10 text-cyan-400 border border-cyan-500/30'
                      : 'text-slate-400 hover:text-slate-200 hover:bg-slate-800/50'
                  }`}
                >
                  <div className="flex items-center gap-2.5">
                    <AlertTriangle className="w-4 h-4" />
                    <span>Security Events</span>
                  </div>
                </button>

                <button
                  onClick={() => {
                    setActiveTab('admin-settings');
                    setSidebarOpen(false);
                  }}
                  className={`w-full flex items-center gap-2.5 px-3 py-2 rounded-xl text-xs font-medium transition-all ${
                    activeTab === 'admin-settings'
                      ? 'bg-cyan-500/10 text-cyan-400 border border-cyan-500/30'
                      : 'text-slate-400 hover:text-slate-200 hover:bg-slate-800/50'
                  }`}
                >
                  <Key className="w-4 h-4" />
                  <span>Profile / Settings</span>
                </button>
              </>
            )}

            {/* 2. DOCUMENT OWNER NAVIGATION */}
            {user.role === 'DOCUMENT_OWNER' && (
              <>
                <div className="px-3 pb-1 text-[10px] font-bold text-slate-400 uppercase tracking-wider">
                  Vault Workspace
                </div>

                <button
                  onClick={() => {
                    setActiveTab('owner-overview');
                    setSidebarOpen(false);
                  }}
                  className={`w-full flex items-center gap-2.5 px-3 py-2 rounded-xl text-xs font-medium transition-all ${
                    activeTab === 'owner-overview'
                      ? 'bg-cyan-500/10 text-cyan-400 border border-cyan-500/30'
                      : 'text-slate-400 hover:text-slate-200 hover:bg-slate-800/50'
                  }`}
                >
                  <LayoutDashboard className="w-4 h-4" />
                  <span>Overview</span>
                </button>

                <button
                  onClick={() => {
                    setActiveTab('owner-documents');
                    setSidebarOpen(false);
                  }}
                  className={`w-full flex items-center justify-between px-3 py-2 rounded-xl text-xs font-medium transition-all ${
                    activeTab === 'owner-documents'
                      ? 'bg-cyan-500/10 text-cyan-400 border border-cyan-500/30'
                      : 'text-slate-400 hover:text-slate-200 hover:bg-slate-800/50'
                  }`}
                >
                  <div className="flex items-center gap-2.5">
                    <Files className="w-4 h-4" />
                    <span>My Documents</span>
                  </div>
                  <span className="px-1.5 py-0.5 rounded text-[10px] font-mono bg-slate-800 text-slate-300">
                    {documents.length}
                  </span>
                </button>

                <button
                  onClick={() => {
                    setActiveTab('owner-upload');
                    setSidebarOpen(false);
                  }}
                  className={`w-full flex items-center gap-2.5 px-3 py-2 rounded-xl text-xs font-medium transition-all ${
                    activeTab === 'owner-upload'
                      ? 'bg-cyan-500/10 text-cyan-400 border border-cyan-500/30'
                      : 'text-slate-400 hover:text-slate-200 hover:bg-slate-800/50'
                  }`}
                >
                  <Upload className="w-4 h-4" />
                  <span>Upload Document</span>
                </button>

                <button
                  onClick={() => {
                    setActiveTab('owner-shares');
                    setSidebarOpen(false);
                  }}
                  className={`w-full flex items-center justify-between px-3 py-2 rounded-xl text-xs font-medium transition-all ${
                    activeTab === 'owner-shares'
                      ? 'bg-cyan-500/10 text-cyan-400 border border-cyan-500/30'
                      : 'text-slate-400 hover:text-slate-200 hover:bg-slate-800/50'
                  }`}
                >
                  <div className="flex items-center gap-2.5">
                    <Share2 className="w-4 h-4" />
                    <span>Shared by Me</span>
                  </div>
                </button>

                <button
                  onClick={() => {
                    setActiveTab('owner-search');
                    setSidebarOpen(false);
                  }}
                  className={`w-full flex items-center gap-2.5 px-3 py-2 rounded-xl text-xs font-medium transition-all ${
                    activeTab === 'owner-search'
                      ? 'bg-cyan-500/10 text-cyan-400 border border-cyan-500/30'
                      : 'text-slate-400 hover:text-slate-200 hover:bg-slate-800/50'
                  }`}
                >
                  <Search className="w-4 h-4" />
                  <span>Search Documents</span>
                </button>

                <button
                  onClick={() => {
                    setActiveTab('owner-activity');
                    setSidebarOpen(false);
                  }}
                  className={`w-full flex items-center gap-2.5 px-3 py-2 rounded-xl text-xs font-medium transition-all ${
                    activeTab === 'owner-activity'
                      ? 'bg-cyan-500/10 text-cyan-400 border border-cyan-500/30'
                      : 'text-slate-400 hover:text-slate-200 hover:bg-slate-800/50'
                  }`}
                >
                  <History className="w-4 h-4" />
                  <span>My Audit History</span>
                </button>

                <button
                  onClick={() => {
                    setActiveTab('owner-settings');
                    setSidebarOpen(false);
                  }}
                  className={`w-full flex items-center gap-2.5 px-3 py-2 rounded-xl text-xs font-medium transition-all ${
                    activeTab === 'owner-settings'
                      ? 'bg-cyan-500/10 text-cyan-400 border border-cyan-500/30'
                      : 'text-slate-400 hover:text-slate-200 hover:bg-slate-800/50'
                  }`}
                >
                  <Key className="w-4 h-4" />
                  <span>Profile / Settings</span>
                </button>
              </>
            )}

            {/* 3. VIEWER NAVIGATION */}
            {user.role === 'VIEWER' && (
              <>
                <div className="px-3 pb-1 text-[10px] font-bold text-slate-400 uppercase tracking-wider">
                  Viewer Workspace
                </div>

                <button
                  onClick={() => {
                    setActiveTab('viewer-overview');
                    setSidebarOpen(false);
                  }}
                  className={`w-full flex items-center gap-2.5 px-3 py-2 rounded-xl text-xs font-medium transition-all ${
                    activeTab === 'viewer-overview'
                      ? 'bg-emerald-500/10 text-emerald-400 border border-emerald-500/30'
                      : 'text-slate-400 hover:text-slate-200 hover:bg-slate-800/50'
                  }`}
                >
                  <LayoutDashboard className="w-4 h-4" />
                  <span>Overview</span>
                </button>

                <button
                  onClick={() => {
                    setActiveTab('viewer-shared');
                    setSidebarOpen(false);
                  }}
                  className={`w-full flex items-center justify-between px-3 py-2 rounded-xl text-xs font-medium transition-all ${
                    activeTab === 'viewer-shared'
                      ? 'bg-emerald-500/10 text-emerald-400 border border-emerald-500/30'
                      : 'text-slate-400 hover:text-slate-200 hover:bg-slate-800/50'
                  }`}
                >
                  <div className="flex items-center gap-2.5">
                    <Eye className="w-4 h-4" />
                    <span>Shared With Me</span>
                  </div>
                  <span className="px-1.5 py-0.5 rounded text-[10px] font-mono bg-slate-800 text-slate-300">
                    {documents.length}
                  </span>
                </button>

                <button
                  onClick={() => {
                    setActiveTab('viewer-search');
                    setSidebarOpen(false);
                  }}
                  className={`w-full flex items-center gap-2.5 px-3 py-2 rounded-xl text-xs font-medium transition-all ${
                    activeTab === 'viewer-search'
                      ? 'bg-emerald-500/10 text-emerald-400 border border-emerald-500/30'
                      : 'text-slate-400 hover:text-slate-200 hover:bg-slate-800/50'
                  }`}
                >
                  <Search className="w-4 h-4" />
                  <span>Search Shared Docs</span>
                </button>

                <button
                  onClick={() => {
                    setActiveTab('viewer-activity');
                    setSidebarOpen(false);
                  }}
                  className={`w-full flex items-center gap-2.5 px-3 py-2 rounded-xl text-xs font-medium transition-all ${
                    activeTab === 'viewer-activity'
                      ? 'bg-emerald-500/10 text-emerald-400 border border-emerald-500/30'
                      : 'text-slate-400 hover:text-slate-200 hover:bg-slate-800/50'
                  }`}
                >
                  <History className="w-4 h-4" />
                  <span>My Activity</span>
                </button>

                <button
                  onClick={() => {
                    setActiveTab('viewer-settings');
                    setSidebarOpen(false);
                  }}
                  className={`w-full flex items-center gap-2.5 px-3 py-2 rounded-xl text-xs font-medium transition-all ${
                    activeTab === 'viewer-settings'
                      ? 'bg-emerald-500/10 text-emerald-400 border border-emerald-500/30'
                      : 'text-slate-400 hover:text-slate-200 hover:bg-slate-800/50'
                  }`}
                >
                  <Key className="w-4 h-4" />
                  <span>Profile / Settings</span>
                </button>
              </>
            )}

            {/* Sign Out Action */}
            <div className="pt-3 border-t border-slate-800/80">
              <button
                onClick={handleLogout}
                className="w-full flex items-center gap-2.5 px-3 py-2 rounded-xl text-xs font-medium text-red-400 hover:bg-red-950/30 transition-colors"
              >
                <LogOut className="w-4 h-4 shrink-0" />
                <span>Sign Out</span>
              </button>
            </div>
          </nav>

          {/* Storage Quota Progress Widget in Sidebar */}
          <div className="p-3.5 border-t border-slate-800/80 bg-slate-950/40">
            <div className="flex items-center justify-between text-[11px] mb-1.5">
              <span className="text-slate-400 font-semibold flex items-center gap-1.5">
                <HardDrive className="w-3.5 h-3.5 text-cyan-400" /> Storage Quota
              </span>
              <span className="text-slate-300 font-mono text-[10px]">{storagePercentage}%</span>
            </div>
            <div className="w-full bg-slate-800 rounded-full h-1.5 overflow-hidden">
              <div
                className="bg-gradient-to-r from-cyan-500 to-blue-500 h-1.5 rounded-full transition-all duration-500"
                style={{ width: `${Math.max(5, storagePercentage)}%` }}
              />
            </div>
            <p className="text-[10px] text-slate-400 mt-1.5 font-mono">
              {formatBytes(totalVolumeBytes)} / {formatBytes(quotaBytes)}
            </p>
            <div className="mt-2 pt-2 border-t border-slate-800/60 flex items-center justify-between text-[10px] font-mono">
              <span className="text-slate-500">DB Status</span>
              <span className={healthStatus?.database_configured ? 'text-emerald-400 font-bold' : 'text-amber-400 font-bold'}>
                {healthStatus?.database_configured ? 'PostgreSQL Connected' : 'Local Fallback'}
              </span>
            </div>
          </div>
        </div>
      </aside>

      {/* MAIN VIEWPORT */}
      <main className="flex-1 min-w-0 bg-[#070b12] flex flex-col min-h-screen">
        {/* Enterprise Top Bar */}
        <header className="h-16 px-6 bg-[#0a0f18]/80 border-b border-slate-800/80 backdrop-blur-xl sticky top-0 z-20 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="text-xs text-slate-400 flex items-center gap-2 font-medium">
              <span className="text-slate-400 hover:text-white transition-colors cursor-pointer">TrustVault</span>
              <ChevronRight className="w-3.5 h-3.5 text-slate-400" />
              <span className="text-white capitalize font-bold">
                {activeTab.replace('admin-', '').replace('owner-', '').replace('viewer-', '').replace('-', ' ')}
              </span>
            </div>
          </div>

          <div className="flex items-center gap-3">
            {/* Zero-Trust Security Pill */}
            <div className="hidden lg:flex items-center gap-2 px-3 py-1 bg-slate-900/90 border border-slate-800 rounded-full text-xs font-mono">
              <span className="w-2 h-2 rounded-full bg-emerald-400 animate-pulse" />
              <span className="text-slate-300 font-semibold">Zero-Trust Active</span>
              <span className="text-slate-400">• HMAC-SHA256</span>
            </div>

            <button
              onClick={refreshData}
              disabled={loadingData}
              title="Refresh Vault Data"
              className="p-2 text-slate-400 hover:text-white rounded-xl bg-slate-900 border border-slate-800 hover:border-slate-700 transition-all disabled:opacity-50"
            >
              <RefreshCw className={`w-4 h-4 ${loadingData ? 'animate-spin text-cyan-400' : ''}`} />
            </button>

            {user.role === 'DOCUMENT_OWNER' && (
              <button
                onClick={() => setActiveTab('owner-upload')}
                className="px-3.5 py-2 bg-gradient-to-r from-cyan-600 to-blue-600 hover:from-cyan-500 hover:to-blue-500 text-white rounded-xl text-xs font-bold shadow-lg shadow-cyan-950/40 flex items-center gap-1.5 transition-all"
              >
                <Upload className="w-3.5 h-3.5" />
                <span>Upload Document</span>
              </button>
            )}
          </div>
        </header>

        {/* DYNAMIC PAGE CONTENT CONTAINER */}
        <div className="flex-1 p-6 space-y-6">
          {/* ========================================================
              ADMIN VIEWS
             ======================================================== */}
          {user.role === 'ADMIN' && (
            <>
              {/* 1. Admin Overview */}
              {activeTab === 'admin-overview' && (
                <div className="space-y-6">
                  {/* High Level Metrics Cards */}
                  <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
                    <div className="p-5 bg-[#0a0f18] border border-slate-800/80 rounded-2xl shadow-sm">
                      <div className="flex items-center justify-between text-slate-400 mb-2">
                        <span className="text-[11px] font-bold uppercase tracking-wider">Registered Users</span>
                        <Users className="w-4 h-4 text-purple-400" />
                      </div>
                      <div className="text-3xl font-black text-white">{adminStats?.total_users ?? 0}</div>
                      <p className="text-[11px] text-slate-400 mt-1">
                        Owners: {adminStats?.role_breakdown?.DOCUMENT_OWNER ?? 0} • Viewers: {adminStats?.role_breakdown?.VIEWER ?? 0}
                      </p>
                    </div>

                    <div className="p-5 bg-[#0a0f18] border border-slate-800/80 rounded-2xl shadow-sm">
                      <div className="flex items-center justify-between text-slate-400 mb-2">
                        <span className="text-[11px] font-bold uppercase tracking-wider">Total Documents</span>
                        <Files className="w-4 h-4 text-cyan-400" />
                      </div>
                      <div className="text-3xl font-black text-white">{adminStats?.total_documents ?? 0}</div>
                      <p className="text-[11px] text-slate-400 mt-1">Encrypted under 48-char keys</p>
                    </div>

                    <div className="p-5 bg-[#0a0f18] border border-slate-800/80 rounded-2xl shadow-sm">
                      <div className="flex items-center justify-between text-slate-400 mb-2">
                        <span className="text-[11px] font-bold uppercase tracking-wider">Active Shares</span>
                        <Share2 className="w-4 h-4 text-emerald-400" />
                      </div>
                      <div className="text-3xl font-black text-white">{adminStats?.active_shares ?? 0}</div>
                      <p className="text-[11px] text-slate-400 mt-1">Total grants: {adminStats?.total_shares ?? 0}</p>
                    </div>

                    <div className="p-5 bg-[#0a0f18] border border-slate-800/80 rounded-2xl shadow-sm">
                      <div className="flex items-center justify-between text-slate-400 mb-2">
                        <span className="text-[11px] font-bold uppercase tracking-wider">Audit Trail Records</span>
                        <History className="w-4 h-4 text-amber-400" />
                      </div>
                      <div className="text-3xl font-black text-white">{adminStats?.total_audit_events ?? 0}</div>
                      <p className="text-[11px] text-slate-400 mt-1">Append-only compliance log</p>
                    </div>
                  </div>

                  {/* Storage breakdown & Security Alerts */}
                  <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
                    <div className="p-6 bg-[#0a0f18] border border-slate-800/80 rounded-2xl">
                      <h3 className="text-sm font-bold text-white mb-4 flex items-center gap-2">
                        <HardDrive className="w-4 h-4 text-cyan-400" />
                        <span>Vault Storage Telemetry</span>
                      </h3>
                      <div className="space-y-4">
                        <div>
                          <div className="flex items-center justify-between text-xs mb-1.5">
                            <span className="text-slate-400">Total Volume Consumed</span>
                            <span className="text-white font-mono font-bold">
                              {formatBytes(adminStats?.storage_used_bytes ?? 0)}
                            </span>
                          </div>
                          <div className="w-full bg-slate-800/80 rounded-full h-2 overflow-hidden">
                            <div className="bg-gradient-to-r from-cyan-500 to-blue-500 h-2 rounded-full w-1/4" />
                          </div>
                        </div>

                        <div className="p-4 bg-slate-950/80 rounded-xl border border-slate-800/80 space-y-2 text-xs">
                          <div className="flex justify-between text-slate-400">
                            <span>Storage Engine</span>
                            <span className="text-slate-200 font-medium">Local Encrypted Volume / Supabase Storage</span>
                          </div>
                          <div className="flex justify-between text-slate-400">
                            <span>Upload Size Limit</span>
                            <span className="text-slate-200 font-medium">10 MB per document</span>
                          </div>
                          <div className="flex justify-between text-slate-400">
                            <span>Key Generation</span>
                            <span className="text-slate-200 font-mono text-[11px]">48-char random hex key</span>
                          </div>
                        </div>
                      </div>
                    </div>

                    <div className="p-6 bg-[#0a0f18] border border-slate-800/80 rounded-2xl">
                      <h3 className="text-sm font-bold text-white mb-4 flex items-center gap-2">
                        <Shield className="w-4 h-4 text-purple-400" />
                        <span>Recent Security Denials & Alerts</span>
                      </h3>
                      {auditLogs.filter((l) => l.action === 'access_denied' || l.action === 'login_failed').length === 0 ? (
                        <div className="p-8 text-center text-slate-400 text-xs">
                          No unauthorized access attempts or failures recorded.
                        </div>
                      ) : (
                        <div className="space-y-2 max-h-56 overflow-y-auto">
                          {auditLogs
                            .filter((l) => l.action === 'access_denied' || l.action === 'login_failed')
                            .slice(0, 5)
                            .map((log) => (
                              <div
                                key={log.id}
                                className="p-3 bg-red-950/30 border border-red-900/40 rounded-xl flex items-center justify-between text-xs"
                              >
                                <div className="flex items-center gap-2">
                                  <AlertCircle className="w-4 h-4 text-red-400" />
                                  <div>
                                    <span className="font-semibold text-red-200 uppercase tracking-wider text-[10px]">
                                      {log.action}
                                    </span>
                                    <p className="text-[11px] text-slate-400 font-mono">Actor: {log.actor_id.slice(0, 8)}...</p>
                                  </div>
                                </div>
                                <span className="text-[10px] text-slate-400 font-mono">{formatDate(log.created_at)}</span>
                              </div>
                            ))}
                        </div>
                      )}
                    </div>
                  </div>
                </div>
              )}

              {/* 2. Admin User Management */}
              {activeTab === 'admin-users' && (
                <div className="bg-[#0a0f18] border border-slate-800/80 rounded-2xl p-6">
                  <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 mb-6">
                    <div>
                      <h3 className="text-base font-bold text-white">Registered Users Governance</h3>
                      <p className="text-xs text-slate-400">
                        Inspect user accounts, document allocations, and modify authorization roles with CSRF safety.
                      </p>
                    </div>
                    <div className="w-full sm:w-64">
                      <input
                        type="text"
                        placeholder="Search by email..."
                        value={searchQuery}
                        onChange={(e) => setSearchQuery(e.target.value)}
                        className="w-full px-3 py-2 bg-slate-950 border border-slate-700/80 rounded-xl text-xs text-white placeholder-slate-500 focus:outline-none focus:ring-2 focus:ring-cyan-500"
                      />
                    </div>
                  </div>

                  <div className="overflow-x-auto">
                    <table className="w-full text-left text-xs">
                      <thead>
                        <tr className="border-b border-slate-800 text-slate-400 uppercase tracking-wider text-[10px]">
                          <th className="pb-3 px-3">User Email</th>
                          <th className="pb-3 px-3">System Role</th>
                          <th className="pb-3 px-3">Documents Owned</th>
                          <th className="pb-3 px-3">Registered Date</th>
                          <th className="pb-3 px-3 text-right">Actions</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-slate-800/60">
                        {adminUsers
                          .filter((u) => u.email.toLowerCase().includes(searchQuery.toLowerCase()))
                          .map((u) => (
                            <tr key={u.id} className="hover:bg-slate-800/30 transition-colors">
                              <td className="py-3 px-3 font-semibold text-white font-mono">{u.email}</td>
                              <td className="py-3 px-3">
                                <span
                                  className={`px-2 py-0.5 rounded text-[10px] font-bold uppercase tracking-wider ${
                                    u.role === 'ADMIN'
                                      ? 'bg-purple-950 text-purple-300 border border-purple-800/60'
                                      : u.role === 'DOCUMENT_OWNER'
                                      ? 'bg-cyan-950 text-cyan-300 border border-cyan-800/60'
                                      : 'bg-emerald-950 text-emerald-300 border border-emerald-800/60'
                                  }`}
                                >
                                  {u.role.replace('_', ' ')}
                                </span>
                              </td>
                              <td className="py-3 px-3 text-slate-300 font-mono">{u.document_count}</td>
                              <td className="py-3 px-3 text-slate-400 font-mono">{formatDate(u.created_at)}</td>
                              <td className="py-3 px-3 text-right">
                                <button
                                  onClick={() => {
                                    setRoleChangeTarget(u);
                                    setSelectedNewRole(u.role);
                                  }}
                                  className="px-2.5 py-1 bg-slate-800 hover:bg-slate-700 text-slate-200 hover:text-white rounded-lg text-xs font-semibold border border-slate-700 transition-colors"
                                >
                                  Modify Role
                                </button>
                              </td>
                            </tr>
                          ))}
                      </tbody>
                    </table>
                  </div>
                </div>
              )}

              {/* 3. All Documents (Metadata Only) */}
              {activeTab === 'admin-documents' && (
                <div className="space-y-4">
                  {/* Zero-Trust Notice */}
                  <div className="p-4 bg-purple-950/40 border border-purple-700/50 rounded-2xl flex items-start gap-3 text-xs text-purple-200">
                    <ShieldCheck className="w-5 h-5 text-purple-400 shrink-0 mt-0.5" />
                    <div>
                      <p className="font-bold text-white mb-0.5">Administrative Least Privilege Policy</p>
                      <p className="text-purple-300 text-[11px]">
                        Admins can audit all document metadata across the system. In accordance with zero-trust principles, direct
                        content downloads are blocked by the backend unless the admin has explicit ownership or an active share.
                      </p>
                    </div>
                  </div>

                  <div className="bg-[#0a0f18] border border-slate-800/80 rounded-2xl p-6">
                    <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 mb-6">
                      <h3 className="text-base font-bold text-white">System Document Inventory ({documents.length})</h3>
                      <div className="w-full sm:w-64">
                        <input
                          type="text"
                          placeholder="Search document name or owner..."
                          value={searchQuery}
                          onChange={(e) => setSearchQuery(e.target.value)}
                          className="w-full px-3 py-2 bg-slate-950 border border-slate-700/80 rounded-xl text-xs text-white placeholder-slate-500 focus:outline-none focus:ring-2 focus:ring-cyan-500"
                        />
                      </div>
                    </div>

                    <div className="overflow-x-auto">
                      <table className="w-full text-left text-xs">
                        <thead>
                          <tr className="border-b border-slate-800 text-slate-400 uppercase tracking-wider text-[10px]">
                            <th className="pb-3 px-3">Document Name</th>
                            <th className="pb-3 px-3">Owner Email</th>
                            <th className="pb-3 px-3">Format / MIME</th>
                            <th className="pb-3 px-3">Size</th>
                            <th className="pb-3 px-3">Uploaded Date</th>
                            <th className="pb-3 px-3 text-right">Content Access</th>
                          </tr>
                        </thead>
                        <tbody className="divide-y divide-slate-800/60">
                          {filteredDocuments.map((doc) => (
                            <tr key={doc.id} className="hover:bg-slate-800/30 transition-colors">
                              <td className="py-3 px-3 font-semibold text-white flex items-center gap-2">
                                {getFileIcon(doc.content_type)}
                                <span className="truncate max-w-xs">{doc.original_filename}</span>
                              </td>
                              <td className="py-3 px-3 text-slate-300 font-mono">{doc.owner_email || doc.owner_id.slice(0, 8) + '...'}</td>
                              <td className="py-3 px-3 text-slate-400 font-mono text-[11px]">{doc.content_type}</td>
                              <td className="py-3 px-3 text-slate-400 font-mono">{formatBytes(doc.size_bytes)}</td>
                              <td className="py-3 px-3 text-slate-400 font-mono">{formatDate(doc.created_at)}</td>
                              <td className="py-3 px-3 text-right">
                                <span className="px-2 py-0.5 rounded text-[10px] font-bold uppercase tracking-wider bg-slate-800 text-slate-400 border border-slate-700">
                                  Restricted (Least Privilege)
                                </span>
                              </td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  </div>
                </div>
              )}

              {/* 4. Audit Logs */}
              {activeTab === 'admin-audit' && (
                <div className="bg-[#0a0f18] border border-slate-800/80 rounded-2xl p-6">
                  <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 mb-6">
                    <div>
                      <h3 className="text-base font-bold text-white">System Compliance Audit Trail</h3>
                      <p className="text-xs text-slate-400">Append-only immutable record of all security-relevant operations.</p>
                    </div>

                    <div className="flex items-center gap-2">
                      <select
                        value={auditFilter}
                        onChange={(e) => setAuditFilter(e.target.value)}
                        className="px-3 py-2 bg-slate-950 border border-slate-700/80 rounded-xl text-xs text-white focus:outline-none focus:ring-2 focus:ring-cyan-500 font-mono"
                      >
                        <option value="">All Actions</option>
                        <option value="document_upload">document_upload</option>
                        <option value="document_download">document_download</option>
                        <option value="document_delete">document_delete</option>
                        <option value="share_granted">share_granted</option>
                        <option value="share_revoked">share_revoked</option>
                        <option value="access_denied">access_denied</option>
                        <option value="admin_role_change">admin_role_change</option>
                        <option value="login_success">login_success</option>
                        <option value="login_failed">login_failed</option>
                      </select>

                      <input
                        type="text"
                        placeholder="Search action or actor..."
                        value={searchQuery}
                        onChange={(e) => setSearchQuery(e.target.value)}
                        className="w-48 px-3 py-2 bg-slate-950 border border-slate-700/80 rounded-xl text-xs text-white placeholder-slate-500 focus:outline-none focus:ring-2 focus:ring-cyan-500"
                      />
                    </div>
                  </div>

                  <div className="overflow-x-auto">
                    <table className="w-full text-left text-xs">
                      <thead>
                        <tr className="border-b border-slate-800 text-slate-400 uppercase tracking-wider text-[10px]">
                          <th className="pb-3 px-3">Timestamp</th>
                          <th className="pb-3 px-3">Action</th>
                          <th className="pb-3 px-3">Actor ID</th>
                          <th className="pb-3 px-3">Document ID</th>
                          <th className="pb-3 px-3">Details</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-slate-800/60">
                        {filteredAuditLogs.map((log) => (
                          <tr key={log.id} className="hover:bg-slate-800/30 transition-colors">
                            <td className="py-3 px-3 text-slate-400 font-mono text-[11px] whitespace-nowrap">
                              {formatDate(log.created_at)}
                            </td>
                            <td className="py-3 px-3">
                              <span
                                className={`px-2 py-0.5 rounded text-[10px] font-bold uppercase tracking-wider font-mono ${
                                  log.action.includes('denied') || log.action.includes('failed')
                                    ? 'bg-red-950 text-red-300 border border-red-800/60'
                                    : log.action.includes('delete') || log.action.includes('revoked')
                                    ? 'bg-amber-950 text-amber-300 border border-amber-800/60'
                                    : log.action.includes('share')
                                    ? 'bg-blue-950 text-blue-300 border border-blue-800/60'
                                    : 'bg-emerald-950 text-emerald-300 border border-emerald-800/60'
                                }`}
                              >
                                {log.action}
                              </span>
                            </td>
                            <td className="py-3 px-3 text-slate-300 font-mono">{log.actor_id.slice(0, 8)}...</td>
                            <td className="py-3 px-3 text-slate-400 font-mono">
                              {log.document_id ? log.document_id.slice(0, 8) + '...' : '—'}
                            </td>
                            <td className="py-3 px-3 text-slate-400 font-mono text-[10px] truncate max-w-xs">
                              {JSON.stringify(log.detail)}
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </div>
              )}

              {/* 5. Permission & Sharing Activity */}
              {activeTab === 'admin-shares' && (
                <div className="bg-[#0a0f18] border border-slate-800/80 rounded-2xl p-6">
                  <h3 className="text-base font-bold text-white mb-2">Permission & Sharing Audit Feed</h3>
                  <p className="text-xs text-slate-400 mb-6">
                    Real-time monitoring of all share permissions granted and revoked across the vault.
                  </p>

                  <div className="space-y-3">
                    {auditLogs
                      .filter((l) => l.action === 'share_granted' || l.action === 'share_revoked')
                      .map((log) => (
                        <div
                          key={log.id}
                          className="p-4 bg-slate-950 border border-slate-800 rounded-xl flex items-center justify-between text-xs"
                        >
                          <div className="flex items-center gap-3">
                            <div
                              className={`p-2 rounded-lg ${
                                log.action === 'share_granted' ? 'bg-cyan-950 text-cyan-400' : 'bg-amber-950 text-amber-400'
                              }`}
                            >
                              <Share2 className="w-4 h-4" />
                            </div>
                            <div>
                              <p className="font-semibold text-white">
                                {log.action === 'share_granted' ? 'Access Granted' : 'Access Revoked'}
                              </p>
                              <p className="text-[11px] text-slate-400 font-mono">
                                Actor: {log.actor_id.slice(0, 8)}... • Details: {JSON.stringify(log.detail)}
                              </p>
                            </div>
                          </div>
                          <span className="text-[11px] text-slate-400 font-mono">{formatDate(log.created_at)}</span>
                        </div>
                      ))}
                  </div>
                </div>
              )}

              {/* 6. Security Events */}
              {activeTab === 'admin-security' && (
                <div className="bg-[#0a0f18] border border-slate-800/80 rounded-2xl p-6">
                  <h3 className="text-base font-bold text-white mb-2">Zero-Trust Security Events</h3>
                  <p className="text-xs text-slate-400 mb-6">
                    Monitoring denied access attempts, authentication anomalies, and administrative privilege changes.
                  </p>

                  <div className="space-y-3">
                    {auditLogs
                      .filter(
                        (l) =>
                          l.action === 'access_denied' ||
                          l.action === 'login_failed' ||
                          l.action === 'admin_role_change'
                      )
                      .map((log) => (
                        <div
                          key={log.id}
                          className="p-4 bg-slate-950 border border-slate-800 rounded-xl flex items-center justify-between text-xs"
                        >
                          <div className="flex items-center gap-3">
                            <div
                              className={`p-2 rounded-lg ${
                                log.action === 'admin_role_change'
                                  ? 'bg-purple-950 text-purple-400'
                                  : 'bg-red-950 text-red-400'
                              }`}
                            >
                              <AlertTriangle className="w-4 h-4" />
                            </div>
                            <div>
                              <span
                                className={`font-bold text-[10px] uppercase tracking-wider px-2 py-0.5 rounded font-mono ${
                                  log.action === 'admin_role_change'
                                    ? 'bg-purple-950 text-purple-300'
                                    : 'bg-red-950 text-red-300'
                                }`}
                              >
                                {log.action}
                              </span>
                              <p className="text-[11px] text-slate-400 mt-1 font-mono">
                                Actor: {log.actor_id.slice(0, 8)}... • Details: {JSON.stringify(log.detail)}
                              </p>
                            </div>
                          </div>
                          <span className="text-[11px] text-slate-400 font-mono">{formatDate(log.created_at)}</span>
                        </div>
                      ))}
                  </div>
                </div>
              )}

              {/* 7. Admin Settings & Profile */}
              {activeTab === 'admin-settings' && (
                <div className="bg-[#0a0f18] border border-slate-800/80 rounded-2xl p-6 space-y-6">
                  <div>
                    <h3 className="text-base font-bold text-white">Administrator Security Profile</h3>
                    <p className="text-xs text-slate-400">Security parameters and zero-trust configuration.</p>
                  </div>

                  <div className="grid grid-cols-1 md:grid-cols-2 gap-4 text-xs">
                    <div className="p-4 bg-slate-950 rounded-xl border border-slate-800 space-y-2">
                      <div className="font-semibold text-white">Session Integrity</div>
                      <div className="flex justify-between text-slate-400">
                        <span>Cookie Name</span>
                        <span className="font-mono text-cyan-400">tv_session</span>
                      </div>
                      <div className="flex justify-between text-slate-400">
                        <span>Cryptographic Signing</span>
                        <span className="text-emerald-400 font-mono">HMAC-SHA256 (32+ bytes secret)</span>
                      </div>
                      <div className="flex justify-between text-slate-400">
                        <span>Attributes</span>
                        <span className="font-mono">HttpOnly, SameSite=Lax</span>
                      </div>
                    </div>

                    <div className="p-4 bg-slate-950 rounded-xl border border-slate-800 space-y-2">
                      <div className="font-semibold text-white">Password & Storage Hashing</div>
                      <div className="flex justify-between text-slate-400">
                        <span>Password Algorithm</span>
                        <span className="text-emerald-400 font-mono">Argon2id (Memory Hard)</span>
                      </div>
                      <div className="flex justify-between text-slate-400">
                        <span>Storage Key Length</span>
                        <span className="text-cyan-400 font-mono">48-char random hex key</span>
                      </div>
                      <div className="flex justify-between text-slate-400">
                        <span>Path Traversal Guard</span>
                        <span className="text-emerald-400">Active</span>
                      </div>
                    </div>
                  </div>
                </div>
              )}
            </>
          )}

          {/* ========================================================
              DOCUMENT OWNER VIEWS
             ======================================================== */}
          {user.role === 'DOCUMENT_OWNER' && (
            <>
              {/* 1. Owner Overview */}
              {activeTab === 'owner-overview' && (
                <div className="space-y-6">
                  {/* Summary Metric Cards */}
                  <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
                    <div className="p-5 bg-[#0a0f18] border border-slate-800/80 rounded-2xl shadow-sm">
                      <div className="flex items-center justify-between text-slate-400 mb-2">
                        <span className="text-xs font-bold uppercase tracking-wider">My Documents</span>
                        <Files className="w-4 h-4 text-cyan-400" />
                      </div>
                      <div className="text-3xl font-black text-white">{documents.length}</div>
                      <p className="text-[11px] text-slate-400 mt-1">Stored in private encrypted vault</p>
                    </div>

                    <div className="p-5 bg-[#0a0f18] border border-slate-800/80 rounded-2xl shadow-sm">
                      <div className="flex items-center justify-between text-slate-400 mb-2">
                        <span className="text-xs font-bold uppercase tracking-wider">Total Volume</span>
                        <HardDrive className="w-4 h-4 text-blue-400" />
                      </div>
                      <div className="text-3xl font-black text-white font-mono">{formatBytes(totalVolumeBytes)}</div>
                      <p className="text-[11px] text-slate-400 mt-1">Isolated on persistent storage</p>
                    </div>

                    <div className="p-5 bg-[#0a0f18] border border-slate-800/80 rounded-2xl shadow-sm">
                      <div className="flex items-center justify-between text-slate-400 mb-2">
                        <span className="text-xs font-bold uppercase tracking-wider">Quick Upload</span>
                        <Upload className="w-4 h-4 text-emerald-400" />
                      </div>
                      <button
                        onClick={() => setActiveTab('owner-upload')}
                        className="mt-1 px-4 py-2 bg-gradient-to-r from-cyan-600 to-blue-600 hover:from-cyan-500 hover:to-blue-500 text-white rounded-xl text-xs font-bold shadow-md transition-all"
                      >
                        Upload New File
                      </button>
                    </div>
                  </div>

                  {/* Recent Documents Table */}
                  <div className="bg-[#0a0f18] border border-slate-800/80 rounded-2xl p-6">
                    <div className="flex items-center justify-between mb-4">
                      <h3 className="text-sm font-bold text-white">Recently Uploaded Documents</h3>
                      <button
                        onClick={() => setActiveTab('owner-documents')}
                        className="text-xs text-cyan-400 hover:text-cyan-300 font-bold flex items-center gap-1"
                      >
                        View All <ChevronRight className="w-3.5 h-3.5" />
                      </button>
                    </div>

                    {documents.length === 0 ? (
                      <div className="p-8 text-center text-slate-400 text-xs">
                        No documents uploaded yet. Click Upload Document to add your first file.
                      </div>
                    ) : (
                      <div className="space-y-2">
                        {documents.slice(0, 5).map((doc) => (
                          <div
                            key={doc.id}
                            className="p-3.5 bg-slate-950 border border-slate-800/80 rounded-xl flex items-center justify-between text-xs hover:border-slate-700 transition-colors"
                          >
                            <div className="flex items-center gap-3">
                              {getFileIcon(doc.content_type)}
                              <div>
                                <span className="font-semibold text-white">{doc.original_filename}</span>
                                <p className="text-[11px] text-slate-400 font-mono">{formatBytes(doc.size_bytes)}</p>
                              </div>
                            </div>
                            <div className="flex items-center gap-2">
                              <button
                                onClick={() => handleDownload(doc)}
                                className="p-2 text-slate-400 hover:text-white rounded-lg hover:bg-slate-800"
                                title="Download"
                              >
                                <Download className="w-4 h-4" />
                              </button>
                              <button
                                onClick={() => openShareModal(doc)}
                                className="p-2 text-slate-400 hover:text-cyan-400 rounded-lg hover:bg-slate-800"
                                title="Share"
                              >
                                <Share2 className="w-4 h-4" />
                              </button>
                            </div>
                          </div>
                        ))}
                      </div>
                    )}
                  </div>
                </div>
              )}

              {/* 2. My Documents */}
              {activeTab === 'owner-documents' && (
                <div className="space-y-4">
                  {/* Search, Filter, and View Controls */}
                  <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
                    <div className="flex items-center gap-2 flex-wrap">
                      <div className="relative">
                        <Search className="w-3.5 h-3.5 text-slate-400 absolute left-3 top-1/2 -translate-y-1/2" />
                        <input
                          type="text"
                          placeholder="Search document name..."
                          value={searchQuery}
                          onChange={(e) => setSearchQuery(e.target.value)}
                          className="pl-8 pr-3 py-2 bg-slate-900 border border-slate-800 rounded-xl text-xs text-white placeholder-slate-500 focus:outline-none focus:ring-2 focus:ring-cyan-500 w-56"
                        />
                      </div>

                      <select
                        value={categoryFilter}
                        onChange={(e) => setCategoryFilter(e.target.value)}
                        className="px-3 py-2 bg-slate-900 border border-slate-800 rounded-xl text-xs text-white focus:outline-none focus:ring-2 focus:ring-cyan-500"
                      >
                        <option value="all">All Formats</option>
                        <option value="pdf">PDF</option>
                        <option value="office">Word / Excel</option>
                        <option value="image">Images</option>
                        <option value="text">Plain Text</option>
                      </select>

                      <select
                        value={sortBy}
                        onChange={(e) => setSortBy(e.target.value as any)}
                        className="px-3 py-2 bg-slate-900 border border-slate-800 rounded-xl text-xs text-white focus:outline-none focus:ring-2 focus:ring-cyan-500 font-mono"
                      >
                        <option value="date-desc">Newest First</option>
                        <option value="date-asc">Oldest First</option>
                        <option value="name-asc">Name (A-Z)</option>
                        <option value="size-desc">Size (Largest)</option>
                      </select>
                    </div>

                    <div className="flex items-center gap-2">
                      <button
                        onClick={() => setViewMode('list')}
                        className={`p-2 rounded-lg border ${
                          viewMode === 'list'
                            ? 'bg-cyan-950/60 border-cyan-500 text-cyan-400'
                            : 'bg-slate-900 border-slate-800 text-slate-400'
                        }`}
                      >
                        <List className="w-4 h-4" />
                      </button>
                      <button
                        onClick={() => setViewMode('grid')}
                        className={`p-2 rounded-lg border ${
                          viewMode === 'grid'
                            ? 'bg-cyan-950/60 border-cyan-500 text-cyan-400'
                            : 'bg-slate-900 border-slate-800 text-slate-400'
                        }`}
                      >
                        <Grid className="w-4 h-4" />
                      </button>
                    </div>
                  </div>

                  {/* Documents List or Grid */}
                  {filteredDocuments.length === 0 ? (
                    <div className="p-12 text-center bg-[#0a0f18] border border-slate-800/80 rounded-2xl">
                      <Folder className="w-12 h-12 text-slate-600 mx-auto mb-3" />
                      <p className="text-sm font-semibold text-slate-300">No documents found</p>
                      <p className="text-xs text-slate-400 mt-1">Upload a document to get started</p>
                    </div>
                  ) : viewMode === 'list' ? (
                    <div className="bg-[#0a0f18] border border-slate-800/80 rounded-2xl overflow-hidden shadow-sm">
                      <table className="w-full text-left text-xs">
                        <thead>
                          <tr className="border-b border-slate-800 text-slate-400 uppercase tracking-wider text-[10px] bg-slate-950/60">
                            <th className="py-3 px-4">Document Name</th>
                            <th className="py-3 px-4">Format</th>
                            <th className="py-3 px-4">Size</th>
                            <th className="py-3 px-4">Upload Date</th>
                            <th className="py-3 px-4 text-right">Actions</th>
                          </tr>
                        </thead>
                        <tbody className="divide-y divide-slate-800/60">
                          {filteredDocuments.map((doc) => (
                            <tr key={doc.id} className="hover:bg-slate-800/30 transition-colors">
                              <td className="py-3.5 px-4 font-semibold text-white flex items-center gap-2.5">
                                {getFileIcon(doc.content_type)}
                                <span className="truncate max-w-sm">{doc.original_filename}</span>
                              </td>
                              <td className="py-3.5 px-4 text-slate-400 font-mono text-[11px]">{doc.content_type}</td>
                              <td className="py-3.5 px-4 text-slate-400 font-mono">{formatBytes(doc.size_bytes)}</td>
                              <td className="py-3.5 px-4 text-slate-400 font-mono">{formatDate(doc.created_at)}</td>
                              <td className="py-3.5 px-4 text-right">
                                <div className="flex items-center justify-end gap-2">
                                  <button
                                    onClick={() => setInspectDoc(doc)}
                                    className="p-1.5 bg-slate-800 hover:bg-slate-700 text-slate-300 rounded-lg transition-colors"
                                    title="Inspect Document Metadata"
                                  >
                                    <Info className="w-3.5 h-3.5" />
                                  </button>
                                  <button
                                    onClick={() => handleDownload(doc)}
                                    className="p-1.5 bg-slate-800 hover:bg-slate-700 text-slate-200 hover:text-white rounded-lg transition-colors"
                                    title="Download Document"
                                  >
                                    <Download className="w-3.5 h-3.5" />
                                  </button>
                                  <button
                                    onClick={() => openShareModal(doc)}
                                    className="p-1.5 bg-slate-800 hover:bg-slate-700 text-cyan-400 hover:text-cyan-300 rounded-lg transition-colors"
                                    title="Manage Sharing"
                                  >
                                    <Share2 className="w-3.5 h-3.5" />
                                  </button>
                                  <button
                                    onClick={() => setDeleteConfirmDoc(doc)}
                                    className="p-1.5 bg-slate-800 hover:bg-red-950 text-red-400 hover:text-red-300 rounded-lg transition-colors"
                                    title="Delete Document"
                                  >
                                    <Trash2 className="w-3.5 h-3.5" />
                                  </button>
                                </div>
                              </td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  ) : (
                    /* Grid View */
                    <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
                      {filteredDocuments.map((doc) => (
                        <div
                          key={doc.id}
                          className="p-5 bg-[#0a0f18] border border-slate-800/80 rounded-2xl flex flex-col justify-between hover:border-slate-700 transition-all shadow-sm"
                        >
                          <div>
                            <div className="flex items-center justify-between mb-3">
                              <div className="p-2.5 bg-slate-950 rounded-xl border border-slate-800">
                                {getFileIcon(doc.content_type)}
                              </div>
                              <span className="text-[10px] font-mono text-slate-400 uppercase">
                                {doc.content_type.split('/')[1] || 'doc'}
                              </span>
                            </div>
                            <h4 className="font-semibold text-sm text-white truncate mb-1">{doc.original_filename}</h4>
                            <p className="text-xs text-slate-400 font-mono mb-3">{formatBytes(doc.size_bytes)}</p>
                          </div>

                          <div className="pt-3 border-t border-slate-800/80 flex items-center justify-between text-xs">
                            <span className="text-[10px] text-slate-400 font-mono">{formatDate(doc.created_at)}</span>
                            <div className="flex items-center gap-1.5">
                              <button
                                onClick={() => setInspectDoc(doc)}
                                className="p-1.5 text-slate-400 hover:text-white rounded-lg hover:bg-slate-800"
                                title="Inspect"
                              >
                                <Info className="w-4 h-4" />
                              </button>
                              <button
                                onClick={() => handleDownload(doc)}
                                className="p-1.5 text-slate-400 hover:text-white rounded-lg hover:bg-slate-800"
                                title="Download"
                              >
                                <Download className="w-4 h-4" />
                              </button>
                              <button
                                onClick={() => openShareModal(doc)}
                                className="p-1.5 text-slate-400 hover:text-cyan-400 rounded-lg hover:bg-slate-800"
                                title="Share"
                              >
                                <Share2 className="w-4 h-4" />
                              </button>
                              <button
                                onClick={() => setDeleteConfirmDoc(doc)}
                                className="p-1.5 text-slate-400 hover:text-red-400 rounded-lg hover:bg-slate-800"
                                title="Delete"
                              >
                                <Trash2 className="w-4 h-4" />
                              </button>
                            </div>
                          </div>
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              )}

              {/* 3. Dedicated Upload Page */}
              {activeTab === 'owner-upload' && (
                <div className="max-w-2xl mx-auto bg-[#0a0f18] border border-slate-800/80 rounded-2xl p-8 space-y-6 shadow-xl">
                  <div>
                    <h3 className="text-base font-bold text-white mb-1">Secure Document Ingestion</h3>
                    <p className="text-xs text-slate-400">
                      Upload confidential files with automated path traversal sanitization and 48-char random storage keys.
                    </p>
                  </div>

                  <form onSubmit={handleUpload} className="space-y-6">
                    <div
                      onDragOver={(e) => e.preventDefault()}
                      onDrop={(e) => {
                        e.preventDefault();
                        if (e.dataTransfer.files?.[0]) {
                          setUploadFile(e.dataTransfer.files[0]);
                        }
                      }}
                      className="border-2 border-dashed border-slate-700/80 hover:border-cyan-500/80 rounded-2xl p-8 text-center bg-slate-950/60 transition-all cursor-pointer"
                      onClick={() => document.getElementById('browseFileInput')?.click()}
                    >
                      <Upload className="w-10 h-10 text-cyan-400 mx-auto mb-3" />
                      <p className="text-sm font-semibold text-white mb-1">
                        {uploadFile ? uploadFile.name : 'Drag & drop confidential file here, or click to browse'}
                      </p>
                      <p className="text-xs text-slate-400 font-mono">
                        {uploadFile ? `${formatBytes(uploadFile.size)} • ${uploadFile.type || 'file'}` : 'Max file size: 10 MB'}
                      </p>
                      <input
                        id="browseFileInput"
                        type="file"
                        className="hidden"
                        onChange={(e) => {
                          if (e.target.files?.[0]) setUploadFile(e.target.files[0]);
                        }}
                      />
                    </div>

                    <div className="p-4 bg-slate-950 rounded-xl border border-slate-800/80 text-xs text-slate-400 space-y-1">
                      <p className="font-semibold text-slate-300">Supported Formats:</p>
                      <p>PDF (.pdf), Microsoft Word (.docx), Excel (.xlsx), Images (.png, .jpg), Text (.txt, .csv)</p>
                    </div>

                    <button
                      type="submit"
                      disabled={!uploadFile || uploading}
                      className="w-full py-3 bg-gradient-to-r from-cyan-600 to-blue-600 hover:from-cyan-500 hover:to-blue-500 text-white font-bold rounded-xl text-sm shadow-xl shadow-cyan-950/40 flex items-center justify-center gap-2 transition-all disabled:opacity-50"
                    >
                      {uploading ? (
                        <>
                          <RefreshCw className="w-4 h-4 animate-spin" /> Storing Encrypted File...
                        </>
                      ) : (
                        <>
                          <Upload className="w-4 h-4" /> Securely Upload to Vault
                        </>
                      )}
                    </button>
                  </form>
                </div>
              )}

              {/* 4. Shared by Me / Manage Sharing */}
              {activeTab === 'owner-shares' && (
                <div className="bg-[#0a0f18] border border-slate-800/80 rounded-2xl p-6">
                  <div className="flex items-center justify-between mb-6">
                    <div>
                      <h3 className="text-base font-bold text-white">Active Sharing & Revocation Console</h3>
                      <p className="text-xs text-slate-400">
                        Inspect all active grants. Revoking a recipient terminates access on their very next request.
                      </p>
                    </div>
                  </div>

                  <div className="space-y-4">
                    {documents.map((doc) => (
                      <div key={doc.id} className="p-4 bg-slate-950 border border-slate-800 rounded-xl">
                        <div className="flex items-center justify-between mb-3">
                          <div className="flex items-center gap-2.5">
                            {getFileIcon(doc.content_type)}
                            <span className="font-semibold text-sm text-white">{doc.original_filename}</span>
                          </div>
                          <button
                            onClick={() => openShareModal(doc)}
                            className="px-3 py-1.5 bg-cyan-950/60 hover:bg-cyan-900/60 text-cyan-300 border border-cyan-800/60 rounded-lg text-xs font-semibold flex items-center gap-1.5 transition-colors"
                          >
                            <Share2 className="w-3.5 h-3.5" />
                            <span>Manage Recipients</span>
                          </button>
                        </div>

                        <p className="text-xs text-slate-400 font-mono">
                          Document ID: <span className="text-slate-300">{doc.id}</span> • Uploaded{' '}
                          {formatDate(doc.created_at)}
                        </p>
                      </div>
                    ))}
                  </div>
                </div>
              )}

              {/* 5. Search Documents */}
              {activeTab === 'owner-search' && (
                <div className="bg-[#0a0f18] border border-slate-800/80 rounded-2xl p-6 space-y-6">
                  <div>
                    <h3 className="text-base font-bold text-white mb-1">Advanced Document Search</h3>
                    <p className="text-xs text-slate-400">Filter your documents by filename, size, and file type.</p>
                  </div>

                  <div className="flex flex-col sm:flex-row gap-3">
                    <div className="flex-1 relative">
                      <Search className="w-4 h-4 text-slate-400 absolute left-3.5 top-1/2 -translate-y-1/2" />
                      <input
                        type="text"
                        placeholder="Search document name..."
                        value={searchQuery}
                        onChange={(e) => setSearchQuery(e.target.value)}
                        className="w-full pl-10 pr-3.5 py-2.5 bg-slate-950 border border-slate-700/80 rounded-xl text-xs text-white placeholder-slate-500 focus:outline-none focus:ring-2 focus:ring-cyan-500"
                      />
                    </div>
                    <select
                      value={categoryFilter}
                      onChange={(e) => setCategoryFilter(e.target.value)}
                      className="px-4 py-2.5 bg-slate-950 border border-slate-700/80 rounded-xl text-xs text-white focus:outline-none focus:ring-2 focus:ring-cyan-500"
                    >
                      <option value="all">All Formats</option>
                      <option value="pdf">PDF Documents</option>
                      <option value="office">Office Documents</option>
                      <option value="image">Images</option>
                      <option value="text">Plain Text</option>
                    </select>
                  </div>

                  <div className="space-y-2">
                    {filteredDocuments.map((doc) => (
                      <div
                        key={doc.id}
                        className="p-3.5 bg-slate-950 border border-slate-800 rounded-xl flex items-center justify-between text-xs hover:border-slate-700 transition-colors"
                      >
                        <div className="flex items-center gap-3">
                          {getFileIcon(doc.content_type)}
                          <div>
                            <p className="font-semibold text-white">{doc.original_filename}</p>
                            <p className="text-[11px] text-slate-400 font-mono">
                              {formatBytes(doc.size_bytes)} • {formatDate(doc.created_at)}
                            </p>
                          </div>
                        </div>
                        <div className="flex items-center gap-2">
                          <button
                            onClick={() => handleDownload(doc)}
                            className="px-3 py-1.5 bg-slate-800 hover:bg-slate-700 text-slate-200 rounded-lg text-xs font-semibold flex items-center gap-1 transition-colors"
                          >
                            <Download className="w-3.5 h-3.5" /> Download
                          </button>
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              )}

              {/* 6. Activity / My Audit History */}
              {activeTab === 'owner-activity' && (
                <div className="bg-[#0a0f18] border border-slate-800/80 rounded-2xl p-6">
                  <h3 className="text-base font-bold text-white mb-2">My Document Audit Trail</h3>
                  <p className="text-xs text-slate-400 mb-6">
                    Scoped activity log of your uploaded documents, downloads, and permission modifications.
                  </p>

                  <div className="space-y-3">
                    {auditLogs
                      .filter((l) => l.actor_id === user.id || documents.some((d) => d.id === l.document_id))
                      .map((log) => (
                        <div
                          key={log.id}
                          className="p-3.5 bg-slate-950 border border-slate-800 rounded-xl flex items-center justify-between text-xs"
                        >
                          <div className="flex items-center gap-3">
                            <History className="w-4 h-4 text-cyan-400" />
                            <div>
                              <span className="font-semibold text-white uppercase text-[10px] tracking-wider font-mono">
                                {log.action}
                              </span>
                              <p className="text-[11px] text-slate-400 font-mono">{JSON.stringify(log.detail)}</p>
                            </div>
                          </div>
                          <span className="text-[10px] text-slate-400 font-mono">{formatDate(log.created_at)}</span>
                        </div>
                      ))}
                  </div>
                </div>
              )}

              {/* 7. Owner Profile / Settings */}
              {activeTab === 'owner-settings' && (
                <div className="bg-[#0a0f18] border border-slate-800/80 rounded-2xl p-6 space-y-6">
                  <div>
                    <h3 className="text-base font-bold text-white">Document Owner Profile</h3>
                    <p className="text-xs text-slate-400">Account metadata and security privileges.</p>
                  </div>

                  <div className="p-4 bg-slate-950 rounded-xl border border-slate-800 space-y-3 text-xs">
                    <div className="flex justify-between text-slate-400">
                      <span>Email</span>
                      <span className="text-white font-mono font-medium">{user.email}</span>
                    </div>
                    <div className="flex justify-between text-slate-400">
                      <span>Role</span>
                      <span className="text-cyan-400 font-bold">DOCUMENT OWNER</span>
                    </div>
                    <div className="flex justify-between text-slate-400">
                      <span>Permissions</span>
                      <span className="text-slate-200">Upload, Manage Shares, Revoke Grants, Delete Own Files</span>
                    </div>
                  </div>
                </div>
              )}
            </>
          )}

          {/* ========================================================
              VIEWER VIEWS
             ======================================================== */}
          {user.role === 'VIEWER' && (
            <>
              {/* 1. Viewer Overview */}
              {activeTab === 'viewer-overview' && (
                <div className="space-y-6">
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                    <div className="p-5 bg-[#0a0f18] border border-slate-800/80 rounded-2xl shadow-sm">
                      <div className="flex items-center justify-between text-slate-400 mb-2">
                        <span className="text-xs font-bold uppercase tracking-wider">Shared With Me</span>
                        <Eye className="w-4 h-4 text-emerald-400" />
                      </div>
                      <div className="text-3xl font-black text-white">{documents.length}</div>
                      <p className="text-[11px] text-slate-400 mt-1">Authorized confidential documents</p>
                    </div>

                    <div className="p-5 bg-[#0a0f18] border border-slate-800/80 rounded-2xl shadow-sm">
                      <div className="flex items-center justify-between text-slate-400 mb-2">
                        <span className="text-xs font-bold uppercase tracking-wider">Quick Action</span>
                        <Files className="w-4 h-4 text-cyan-400" />
                      </div>
                      <button
                        onClick={() => setActiveTab('viewer-shared')}
                        className="mt-1 px-4 py-2 bg-emerald-600 hover:bg-emerald-500 text-white rounded-xl text-xs font-bold shadow-md transition-all"
                      >
                        Inspect Shared Files
                      </button>
                    </div>
                  </div>

                  {/* Recently Shared with Me */}
                  <div className="bg-[#0a0f18] border border-slate-800/80 rounded-2xl p-6">
                    <h3 className="text-sm font-bold text-white mb-4">Accessible Documents</h3>
                    {documents.length === 0 ? (
                      <div className="p-8 text-center text-slate-400 text-xs">
                        No documents are currently shared with your account.
                      </div>
                    ) : (
                      <div className="space-y-2">
                        {documents.map((doc) => (
                          <div
                            key={doc.id}
                            className="p-3.5 bg-slate-950 border border-slate-800 rounded-xl flex items-center justify-between text-xs"
                          >
                            <div className="flex items-center gap-3">
                              {getFileIcon(doc.content_type)}
                              <div>
                                <p className="font-semibold text-white">{doc.original_filename}</p>
                                <p className="text-[11px] text-slate-400 font-mono">
                                  Owner: {doc.owner_email || 'Authorized Owner'} • {formatBytes(doc.size_bytes)}
                                </p>
                              </div>
                            </div>
                            <button
                              onClick={() => handleDownload(doc)}
                              className="px-3.5 py-1.5 bg-emerald-600 hover:bg-emerald-500 text-white rounded-lg text-xs font-bold flex items-center gap-1.5 transition-colors shadow-sm"
                            >
                              <Download className="w-3.5 h-3.5" /> Download
                            </button>
                          </div>
                        ))}
                      </div>
                    )}
                  </div>
                </div>
              )}

              {/* 2. Shared With Me */}
              {activeTab === 'viewer-shared' && (
                <div className="bg-[#0a0f18] border border-slate-800/80 rounded-2xl p-6">
                  <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 mb-6">
                    <div>
                      <h3 className="text-base font-bold text-white">Documents Shared With Me</h3>
                      <p className="text-xs text-slate-400">
                        Zero-trust access: Permissions are checked on every request. Revoked links stop working immediately.
                      </p>
                    </div>
                    <div className="w-full sm:w-64">
                      <input
                        type="text"
                        placeholder="Search accessible documents..."
                        value={searchQuery}
                        onChange={(e) => setSearchQuery(e.target.value)}
                        className="w-full px-3 py-2 bg-slate-950 border border-slate-700/80 rounded-xl text-xs text-white placeholder-slate-500 focus:outline-none focus:ring-2 focus:ring-emerald-500"
                      />
                    </div>
                  </div>

                  {documents.length === 0 ? (
                    <div className="p-12 text-center bg-slate-950/60 border border-slate-800 rounded-2xl">
                      <Eye className="w-12 h-12 text-slate-600 mx-auto mb-3" />
                      <p className="text-sm font-semibold text-slate-300">No shared documents available</p>
                      <p className="text-xs text-slate-400 mt-1">When an owner grants you access, documents appear here.</p>
                    </div>
                  ) : (
                    <div className="overflow-x-auto">
                      <table className="w-full text-left text-xs">
                        <thead>
                          <tr className="border-b border-slate-800 text-slate-400 uppercase tracking-wider text-[10px] bg-slate-950/60">
                            <th className="py-3 px-3">Document Name</th>
                            <th className="py-3 px-3">Owner / Sender</th>
                            <th className="py-3 px-3">Format</th>
                            <th className="py-3 px-3">Size</th>
                            <th className="py-3 px-3">Permission</th>
                            <th className="py-3 px-3 text-right">Actions</th>
                          </tr>
                        </thead>
                        <tbody className="divide-y divide-slate-800/60">
                          {filteredDocuments.map((doc) => (
                            <tr key={doc.id} className="hover:bg-slate-800/30 transition-colors">
                              <td className="py-3 px-3 font-semibold text-white flex items-center gap-2">
                                {getFileIcon(doc.content_type)}
                                <span>{doc.original_filename}</span>
                              </td>
                              <td className="py-3 px-3 text-slate-300 font-mono">{doc.owner_email || 'Vault Owner'}</td>
                              <td className="py-3 px-3 text-slate-400 font-mono text-[11px]">{doc.content_type}</td>
                              <td className="py-3 px-3 text-slate-400 font-mono">{formatBytes(doc.size_bytes)}</td>
                              <td className="py-3 px-3">
                                <span className="px-2 py-0.5 rounded text-[10px] font-bold uppercase tracking-wider bg-emerald-950 text-emerald-300 border border-emerald-800/60">
                                  Read Access
                                </span>
                              </td>
                              <td className="py-3 px-3 text-right">
                                <button
                                  onClick={() => handleDownload(doc)}
                                  className="px-3.5 py-1.5 bg-emerald-600 hover:bg-emerald-500 text-white rounded-lg text-xs font-bold flex items-center gap-1.5 ml-auto transition-colors shadow-sm"
                                >
                                  <Download className="w-3.5 h-3.5" /> Download
                                </button>
                              </td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  )}
                </div>
              )}

              {/* 3. Search Shared Documents */}
              {activeTab === 'viewer-search' && (
                <div className="bg-[#0a0f18] border border-slate-800/80 rounded-2xl p-6 space-y-6">
                  <div>
                    <h3 className="text-base font-bold text-white mb-1">Search Accessible Documents</h3>
                    <p className="text-xs text-slate-400">Search by filename or sender email.</p>
                  </div>

                  <div className="relative">
                    <Search className="w-4 h-4 text-slate-400 absolute left-3.5 top-1/2 -translate-y-1/2" />
                    <input
                      type="text"
                      placeholder="Type document name..."
                      value={searchQuery}
                      onChange={(e) => setSearchQuery(e.target.value)}
                      className="w-full pl-10 pr-3.5 py-2.5 bg-slate-950 border border-slate-700/80 rounded-xl text-xs text-white placeholder-slate-500 focus:outline-none focus:ring-2 focus:ring-emerald-500"
                    />
                  </div>

                  <div className="space-y-2">
                    {filteredDocuments.map((doc) => (
                      <div
                        key={doc.id}
                        className="p-3.5 bg-slate-950 border border-slate-800 rounded-xl flex items-center justify-between text-xs"
                      >
                        <div className="flex items-center gap-3">
                          {getFileIcon(doc.content_type)}
                          <div>
                            <p className="font-semibold text-white">{doc.original_filename}</p>
                            <p className="text-[11px] text-slate-400 font-mono">{formatBytes(doc.size_bytes)}</p>
                          </div>
                        </div>
                        <button
                          onClick={() => handleDownload(doc)}
                          className="px-3.5 py-1.5 bg-slate-800 hover:bg-slate-700 text-slate-200 rounded-lg text-xs font-semibold flex items-center gap-1.5"
                        >
                          <Download className="w-3.5 h-3.5" /> Download
                        </button>
                      </div>
                    ))}
                  </div>
                </div>
              )}

              {/* 4. Viewer My Activity */}
              {activeTab === 'viewer-activity' && (
                <div className="bg-[#0a0f18] border border-slate-800/80 rounded-2xl p-6">
                  <h3 className="text-base font-bold text-white mb-2">My Access Activity</h3>
                  <p className="text-xs text-slate-400 mb-6">Audit record of your authorized downloads and vault sessions.</p>

                  <div className="space-y-3">
                    {auditLogs
                      .filter((l) => l.actor_id === user.id)
                      .map((log) => (
                        <div
                          key={log.id}
                          className="p-3.5 bg-slate-950 border border-slate-800 rounded-xl flex items-center justify-between text-xs"
                        >
                          <div className="flex items-center gap-3">
                            <History className="w-4 h-4 text-emerald-400" />
                            <div>
                              <span className="font-semibold text-white uppercase text-[10px] font-mono">{log.action}</span>
                              <p className="text-[11px] text-slate-400 font-mono">Document: {log.document_id || 'System'}</p>
                            </div>
                          </div>
                          <span className="text-[10px] text-slate-400 font-mono">{formatDate(log.created_at)}</span>
                        </div>
                      ))}
                  </div>
                </div>
              )}

              {/* 5. Viewer Settings & Profile */}
              {activeTab === 'viewer-settings' && (
                <div className="bg-[#0a0f18] border border-slate-800/80 rounded-2xl p-6 space-y-6">
                  <div>
                    <h3 className="text-base font-bold text-white">Viewer Account Profile</h3>
                    <p className="text-xs text-slate-400">Account status and access tier.</p>
                  </div>

                  <div className="p-4 bg-slate-950 rounded-xl border border-slate-800 space-y-3 text-xs">
                    <div className="flex justify-between text-slate-400">
                      <span>Email</span>
                      <span className="text-white font-mono font-medium">{user.email}</span>
                    </div>
                    <div className="flex justify-between text-slate-400">
                      <span>Role</span>
                      <span className="text-emerald-400 font-bold">VIEWER (Read-Only Recipient)</span>
                    </div>
                    <div className="flex justify-between text-slate-400">
                      <span>Access Rule</span>
                      <span className="text-slate-200">Can view and download only documents with active share grants</span>
                    </div>
                  </div>
                </div>
              )}
            </>
          )}
        </div>
      </main>

      {/* ========================================================
          ENTERPRISE MODALS & DIALOGS
         ======================================================== */}

      {/* 1. DOCUMENT INTELLIGENCE INSPECTOR MODAL */}
      {inspectDoc && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-950/80 backdrop-blur-sm">
          <div className="bg-slate-900 border border-slate-800 rounded-2xl max-w-lg w-full p-6 shadow-2xl space-y-5">
            <div className="flex items-center justify-between pb-3 border-b border-slate-800">
              <div className="flex items-center gap-2.5">
                <FileCheck2 className="w-5 h-5 text-cyan-400" />
                <h3 className="font-bold text-white text-base">Document Security Inspector</h3>
              </div>
              <button onClick={() => setInspectDoc(null)} className="text-slate-400 hover:text-white">
                <X className="w-5 h-5" />
              </button>
            </div>

            <div className="space-y-3 text-xs">
              <div className="p-3 bg-slate-950 rounded-xl border border-slate-800 space-y-1.5">
                <p className="font-bold text-white text-sm">{inspectDoc.original_filename}</p>
                <p className="text-[11px] text-slate-400 font-mono">UUID: {inspectDoc.id}</p>
              </div>

              <div className="grid grid-cols-2 gap-2">
                <div className="p-3 bg-slate-950 rounded-xl border border-slate-800">
                  <span className="text-slate-400 block text-[10px] uppercase font-bold">Format</span>
                  <span className="text-white font-mono font-semibold">{inspectDoc.content_type}</span>
                </div>
                <div className="p-3 bg-slate-950 rounded-xl border border-slate-800">
                  <span className="text-slate-400 block text-[10px] uppercase font-bold">Exact Size</span>
                  <span className="text-white font-mono font-semibold">{formatBytes(inspectDoc.size_bytes)} ({inspectDoc.size_bytes} bytes)</span>
                </div>
              </div>

              <div className="p-3 bg-slate-950 rounded-xl border border-slate-800 space-y-1.5">
                <div className="flex justify-between text-slate-400">
                  <span>Storage Architecture</span>
                  <span className="text-cyan-400 font-mono">48-char Hex Key</span>
                </div>
                <div className="flex justify-between text-slate-400">
                  <span>Path Traversal Guard</span>
                  <span className="text-emerald-400 font-semibold">Enforced (Safe Resolve)</span>
                </div>
                <div className="flex justify-between text-slate-400">
                  <span>Cache Policy</span>
                  <span className="text-slate-200 font-mono">no-store, nosniff</span>
                </div>
              </div>
            </div>

            <div className="flex justify-end gap-2 pt-2">
              <button
                onClick={() => setInspectDoc(null)}
                className="px-4 py-2 bg-slate-800 hover:bg-slate-700 text-white rounded-xl text-xs font-semibold"
              >
                Close Inspector
              </button>
            </div>
          </div>
        </div>
      )}

      {/* 2. SHARE DOCUMENT MODAL */}
      {shareModalDoc && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-950/80 backdrop-blur-sm">
          <div className="bg-slate-900 border border-slate-800 rounded-2xl max-w-lg w-full p-6 shadow-2xl space-y-6">
            <div className="flex items-center justify-between pb-3 border-b border-slate-800">
              <div className="flex items-center gap-2">
                <Share2 className="w-5 h-5 text-cyan-400" />
                <h3 className="font-bold text-white text-base">Share Document</h3>
              </div>
              <button onClick={() => setShareModalDoc(null)} className="text-slate-400 hover:text-white">
                <X className="w-5 h-5" />
              </button>
            </div>

            <div>
              <p className="text-xs font-semibold text-slate-300 truncate">
                Document: <span className="text-cyan-400 font-mono">{shareModalDoc.original_filename}</span>
              </p>
              <p className="text-[11px] text-slate-400 font-mono mt-0.5">UUID: {shareModalDoc.id}</p>
            </div>

            {/* 1-Click Fast Share Demo Button */}
            <div className="p-3.5 bg-cyan-950/40 border border-cyan-800/50 rounded-xl flex items-center justify-between">
              <div>
                <p className="text-xs font-bold text-cyan-200">1-Click Share Demo</p>
                <p className="text-[10px] text-cyan-400 font-mono">Instantly grant access to viewer@trustvault.local</p>
              </div>
              <button
                type="button"
                onClick={() => handleCreateShare(undefined, 'viewer@trustvault.local')}
                disabled={sharingSubmitting}
                className="px-3.5 py-1.5 bg-cyan-600 hover:bg-cyan-500 text-white rounded-lg text-xs font-bold transition-colors disabled:opacity-50 shadow-sm"
              >
                Share with Demo Viewer
              </button>
            </div>

            {/* Email Notification Status Note */}
            {shareEmailStatus && (
              <div className="p-3 bg-slate-950 border border-slate-800 rounded-xl text-xs text-slate-300 flex items-start gap-2">
                <Info className="w-4 h-4 text-cyan-400 shrink-0 mt-0.5" />
                <span>{shareEmailStatus}</span>
              </div>
            )}

            {/* Share Form */}
            <form onSubmit={handleCreateShare} className="space-y-4">
              <div>
                <label className="block text-xs font-semibold text-slate-300 mb-1">Select Registered Recipient</label>
                <select
                  value={recipientEmail}
                  onChange={(e) => setRecipientEmail(e.target.value)}
                  className="w-full px-3.5 py-2.5 bg-slate-950 border border-slate-700/80 rounded-xl text-xs text-white focus:outline-none focus:ring-2 focus:ring-cyan-500 font-mono"
                >
                  <option value="">-- Choose recipient or type below --</option>
                  {availableRecipients.map((rec) => (
                    <option key={rec.id} value={rec.email}>
                      {rec.email} ({rec.role})
                    </option>
                  ))}
                </select>
              </div>

              <div>
                <label className="block text-xs font-semibold text-slate-300 mb-1">Or Enter Recipient Email</label>
                <div className="flex gap-2">
                  <input
                    type="email"
                    value={recipientEmail}
                    onChange={(e) => setRecipientEmail(e.target.value)}
                    placeholder="recipient@trustvault.local"
                    className="flex-1 px-3.5 py-2.5 bg-slate-950 border border-slate-700/80 rounded-xl text-xs text-white focus:outline-none focus:ring-2 focus:ring-cyan-500 font-mono"
                  />
                  <button
                    type="submit"
                    disabled={!recipientEmail || sharingSubmitting}
                    className="px-4 py-2.5 bg-cyan-600 hover:bg-cyan-500 text-white rounded-xl text-xs font-bold shadow-md transition-all disabled:opacity-50"
                  >
                    Grant Access
                  </button>
                </div>
              </div>
            </form>

            {/* Active Shares List with Revocation */}
            <div className="pt-4 border-t border-slate-800">
              <h4 className="text-xs font-bold text-white mb-3">Active Access Grants</h4>
              {loadingShares ? (
                <div className="py-4 text-center text-xs text-slate-400">Loading grants...</div>
              ) : docShares.length === 0 ? (
                <div className="py-4 text-center text-xs text-slate-400">No active shares. Document is private.</div>
              ) : (
                <div className="space-y-2 max-h-48 overflow-y-auto">
                  {docShares.map((share) => (
                    <div
                      key={share.id}
                      className="p-3 bg-slate-950 border border-slate-800 rounded-xl flex items-center justify-between text-xs"
                    >
                      <div>
                        <p className="font-semibold text-white font-mono">{share.recipient_email}</p>
                        <span
                          className={`inline-block px-1.5 py-0.5 rounded text-[9px] font-bold uppercase mt-0.5 ${
                            share.is_active
                              ? 'bg-emerald-950 text-emerald-300 border border-emerald-800/60'
                              : 'bg-red-950 text-red-400 border border-red-900/40'
                          }`}
                        >
                          {share.is_active ? 'Active Grant' : 'Revoked'}
                        </span>
                      </div>

                      {share.is_active && (
                        <button
                          onClick={() =>
                            setRevokeConfirmShare({
                              docId: share.document_id,
                              shareId: share.id,
                              recipientEmail: share.recipient_email,
                            })
                          }
                          className="px-2.5 py-1 bg-red-950/60 hover:bg-red-900/60 text-red-300 border border-red-800/60 rounded-lg text-xs font-semibold transition-colors"
                        >
                          Revoke Access
                        </button>
                      )}
                    </div>
                  ))}
                </div>
              )}
            </div>
          </div>
        </div>
      )}

      {/* 3. CONFIRM REVOCATION MODAL */}
      {revokeConfirmShare && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-950/80 backdrop-blur-sm">
          <div className="bg-slate-900 border border-slate-800 rounded-2xl max-w-md w-full p-6 shadow-2xl space-y-4">
            <div className="flex items-center gap-3 text-amber-400">
              <AlertTriangle className="w-6 h-6" />
              <h3 className="font-bold text-white text-base">Confirm Immediate Revocation</h3>
            </div>
            <p className="text-xs text-slate-300">
              Are you sure you want to revoke access for{' '}
              <strong className="text-white font-mono">{revokeConfirmShare.recipientEmail}</strong>?
            </p>
            <p className="text-[11px] text-amber-300/80 bg-amber-950/40 p-3 rounded-xl border border-amber-900/40">
              Zero-Trust Enforcement: The recipient will immediately receive 403 Forbidden on their very next request.
            </p>
            <div className="flex justify-end gap-2 pt-2">
              <button
                onClick={() => setRevokeConfirmShare(null)}
                className="px-3.5 py-2 bg-slate-800 hover:bg-slate-700 text-slate-200 rounded-xl text-xs font-semibold"
              >
                Cancel
              </button>
              <button
                onClick={handleRevokeShare}
                disabled={revokingShare}
                className="px-4 py-2 bg-red-600 hover:bg-red-500 text-white rounded-xl text-xs font-semibold transition-colors disabled:opacity-50"
              >
                {revokingShare ? 'Revoking...' : 'Revoke Immediately'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* 4. CONFIRM DELETE DOCUMENT MODAL */}
      {deleteConfirmDoc && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-950/80 backdrop-blur-sm">
          <div className="bg-slate-900 border border-slate-800 rounded-2xl max-w-md w-full p-6 shadow-2xl space-y-4">
            <div className="flex items-center gap-3 text-red-400">
              <Trash2 className="w-6 h-6" />
              <h3 className="font-bold text-white text-base">Permanently Delete Document</h3>
            </div>
            <p className="text-xs text-slate-300">
              Are you sure you want to delete <strong className="text-white">"{deleteConfirmDoc.original_filename}"</strong>?
            </p>
            <p className="text-[11px] text-red-300/80 bg-red-950/40 p-3 rounded-xl border border-red-900/40">
              Warning: The physical file on disk and all associated active shares will be permanently purged. This action is
              recorded in the audit trail.
            </p>
            <div className="flex justify-end gap-2 pt-2">
              <button
                onClick={() => setDeleteConfirmDoc(null)}
                className="px-3.5 py-2 bg-slate-800 hover:bg-slate-700 text-slate-200 rounded-xl text-xs font-semibold"
              >
                Cancel
              </button>
              <button
                onClick={handleDeleteDocument}
                disabled={deletingDoc}
                className="px-4 py-2 bg-red-600 hover:bg-red-500 text-white rounded-xl text-xs font-semibold transition-colors disabled:opacity-50"
              >
                {deletingDoc ? 'Deleting...' : 'Delete Permanently'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* 5. MODIFY USER ROLE MODAL (ADMIN) */}
      {roleChangeTarget && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-950/80 backdrop-blur-sm">
          <div className="bg-slate-900 border border-slate-800 rounded-2xl max-w-md w-full p-6 shadow-2xl space-y-4">
            <div className="flex items-center gap-3 text-purple-400">
              <Users className="w-6 h-6" />
              <h3 className="font-bold text-white text-base">Modify User Role</h3>
            </div>
            <p className="text-xs text-slate-300">
              Select new authorization role for <strong className="text-white font-mono">{roleChangeTarget.email}</strong>:
            </p>

            <div className="space-y-2">
              {(['ADMIN', 'DOCUMENT_OWNER', 'VIEWER'] as UserRole[]).map((r) => (
                <button
                  key={r}
                  type="button"
                  onClick={() => setSelectedNewRole(r)}
                  className={`w-full p-3 rounded-xl border text-left flex items-center justify-between text-xs transition-all ${
                    selectedNewRole === r
                      ? 'bg-purple-950/40 border-purple-500 text-purple-300 font-bold'
                      : 'bg-slate-950 border-slate-800 text-slate-400'
                  }`}
                >
                  <span>{r.replace('_', ' ')}</span>
                  {selectedNewRole === r && <CheckCircle className="w-4 h-4 text-purple-400" />}
                </button>
              ))}
            </div>

            <p className="text-[11px] text-slate-400">
              Sole-Admin Safeguard: Demoting the only active administrator is blocked by backend integrity checks.
            </p>

            <div className="flex justify-end gap-2 pt-2">
              <button
                onClick={() => setRoleChangeTarget(null)}
                className="px-3.5 py-2 bg-slate-800 hover:bg-slate-700 text-slate-200 rounded-xl text-xs font-semibold"
              >
                Cancel
              </button>
              <button
                onClick={handleUpdateRole}
                disabled={updatingRole}
                className="px-4 py-2 bg-purple-600 hover:bg-purple-500 text-white rounded-xl text-xs font-semibold transition-colors disabled:opacity-50"
              >
                {updatingRole ? 'Updating...' : 'Save Role Change'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* 6. SESSION SECURITY SETTINGS MODAL */}
      {settingsModalOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-950/80 backdrop-blur-sm">
          <div className="bg-slate-900 border border-slate-800 rounded-2xl max-w-lg w-full p-6 shadow-2xl space-y-5">
            <div className="flex items-center justify-between pb-3 border-b border-slate-800">
              <div className="flex items-center gap-2">
                <ShieldCheck className="w-5 h-5 text-cyan-400" />
                <h3 className="font-bold text-white text-base">Vault Security Status</h3>
              </div>
              <button onClick={() => setSettingsModalOpen(false)} className="text-slate-400 hover:text-white">
                <X className="w-5 h-5" />
              </button>
            </div>

            <div className="space-y-3 text-xs">
              <div className="p-3 bg-slate-950 rounded-xl border border-slate-800 flex justify-between items-center">
                <span className="text-slate-400">Session Cookie (`tv_session`)</span>
                <span className="text-emerald-400 font-mono font-semibold">HttpOnly, SameSite=Lax</span>
              </div>
              <div className="p-3 bg-slate-950 rounded-xl border border-slate-800 flex justify-between items-center">
                <span className="text-slate-400">Signature Verification</span>
                <span className="text-emerald-400 font-mono font-semibold">HMAC-SHA256 (Constant Time)</span>
              </div>
              <div className="p-3 bg-slate-950 rounded-xl border border-slate-800 flex justify-between items-center">
                <span className="text-slate-400">CSRF Token Guard</span>
                <span className="text-emerald-400 font-mono font-semibold">Session-Bound (X-CSRF-Token)</span>
              </div>
              <div className="p-3 bg-slate-950 rounded-xl border border-slate-800 flex justify-between items-center">
                <span className="text-slate-400">Password Hashing</span>
                <span className="text-emerald-400 font-mono font-semibold">Argon2id (Memory Hard)</span>
              </div>
              <div className="p-3 bg-slate-950 rounded-xl border border-slate-800 flex justify-between items-center">
                <span className="text-slate-400">File Storage Security</span>
                <span className="text-cyan-400 font-mono font-semibold">Isolated 48-char hex keys</span>
              </div>
            </div>

            <button
              onClick={() => setSettingsModalOpen(false)}
              className="w-full py-2.5 bg-slate-800 hover:bg-slate-700 text-white rounded-xl text-xs font-semibold"
            >
              Close
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
