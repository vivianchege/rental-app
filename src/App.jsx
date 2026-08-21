import React, { useState, useEffect, useMemo } from 'react';
import { 
  Users, Home, Wallet, Wrench, LayoutDashboard, LogOut, 
  CheckCircle2, Plus, AlertCircle, Phone, X, ShieldCheck,
  Check, Clock, FileText, Calendar, Edit, Info, Coins, ListOrdered,
  Droplet, Truck, Sun, Moon, BellRing, Menu,
  Eye, EyeOff, Download, Search, ReceiptText, FileBarChart,
  Settings, ShieldAlert, Bell, Building2, Activity,
  SlidersHorizontal, Database, ArrowUpRight
} from 'lucide-react';
import { allocatePayment, parseMoney } from './lib/money';
import { hasPermission, normalizeRole, PERMISSIONS, ROLES } from './lib/permissions';

// --- FIREBASE IMPORTS ---
import { initializeApp, getApps, getApp } from 'firebase/app';
import { 
  getAuth, 
  signInWithEmailAndPassword, 
  onAuthStateChanged, 
  signOut, 
  sendPasswordResetEmail,
  getIdTokenResult,
  GoogleAuthProvider,
  signInWithPopup
} from 'firebase/auth';
import { 
  getFirestore, 
  collection, 
  onSnapshot, 
  doc, 
  addDoc, 
  updateDoc, 
  getDoc,
  runTransaction,
  query,
  where,
  enableIndexedDbPersistence 
} from 'firebase/firestore';

// --- FIREBASE SETUP ---
const firebaseConfig = {
  apiKey: import.meta.env.VITE_FIREBASE_API_KEY || '',
  authDomain: import.meta.env.VITE_FIREBASE_AUTH_DOMAIN || '',
  projectId: import.meta.env.VITE_FIREBASE_PROJECT_ID || '',
  storageBucket: import.meta.env.VITE_FIREBASE_STORAGE_BUCKET || '',
  messagingSenderId: import.meta.env.VITE_FIREBASE_MESSAGING_SENDER_ID || '',
  appId: import.meta.env.VITE_FIREBASE_APP_ID || ''
};

const isFirebaseConfigured = Object.values(firebaseConfig).every(Boolean);
const app = isFirebaseConfigured ? (getApps().length === 0 ? initializeApp(firebaseConfig) : getApp()) : null;
const auth = app ? getAuth(app) : null;
const db = app ? getFirestore(app) : null;
const appId = firebaseConfig.projectId || 'house-management-portal';
const DEFAULT_CURRENCY = import.meta.env.VITE_DEFAULT_CURRENCY || 'KES';
const DEFAULT_TIMEZONE = import.meta.env.VITE_DEFAULT_TIMEZONE || 'Africa/Nairobi';
const DEFAULT_WORKSPACE_ID = import.meta.env.VITE_DEFAULT_WORKSPACE_ID || 'main-workspace';

// Temporary compatibility bridge for the existing live accounts. Create users/{uid}
// profiles and remove this bridge after the migration is complete.
const LEGACY_ROLE_BY_UID = {
  [import.meta.env.VITE_LEGACY_LANDLORD_UID || 'b4HMBcL0WXT3Qg2vunj5ITZOVb72']: ROLES.LANDLORD,
  [import.meta.env.VITE_LEGACY_MANAGER_UID_1 || 'CG6wl2NaTcdLHyGlXHk4w9eCU653']: ROLES.MANAGER,
  [import.meta.env.VITE_LEGACY_MANAGER_UID_2 || 'N8wEpIJvUZRmD6WoYYxqpUiiLhj2']: ROLES.MANAGER,
};

// FORCE FRESH DATA SYNC
if (db) {
  enableIndexedDbPersistence(db).catch(() => {
    // Offline persistence is optional. The live session remains usable when another tab owns the cache.
  });
}

// Safe database timeout wrapper to prevent sandbox freezes
const promiseTimeout = (promise, ms = 15000) => {
  return Promise.race([
    promise,
    new Promise((_, reject) => setTimeout(() => reject(new Error("Database operation timed out. Please check your network connection.")), ms))
  ]);
};

const escapeHtml = (value) => String(value ?? '')
  .replaceAll('&', '&amp;')
  .replaceAll('<', '&lt;')
  .replaceAll('>', '&gt;')
  .replaceAll('"', '&quot;')
  .replaceAll("'", '&#039;');

export default function App() {
  const [theme, setTheme] = useState(() => localStorage.getItem('ruiru_theme') || 'light');
  const [user, setUser] = useState(null);
  const [role, setRole] = useState(null);
  const [userProfile, setUserProfile] = useState(null);
  const [activeTab, setActiveTab] = useState('dashboard');
  const [loading, setLoading] = useState(true);
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const [globalSearch, setGlobalSearch] = useState('');
  const [dataError, setDataError] = useState('');

  // Global states for errors and visual loading states
  const [isProcessing, setIsProcessing] = useState(false);
  const [modalError, setModalError] = useState('');

  // Authentication State Variables
  const [loginTab, setLoginTab] = useState('landlord'); 
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [loginError, setLoginError] = useState('');
  const [showWelcomeScreen, setShowWelcomeScreen] = useState(false);

  // Live Database States
  const [houses, setHouses] = useState([]);
  const [tenants, setTenants] = useState([]);
  const [payments, setPayments] = useState([]);
  const [repairs, setRepairs] = useState([]);
  const [septicLogs, setSepticLogs] = useState([]);
  const [masterWaterBills, setMasterWaterBills] = useState([]);
  const [expenses, setExpenses] = useState([]);
  const [activityLogs, setActivityLogs] = useState([]);
  const [notifications, setNotifications] = useState([]);

  // Modals Visibility Controllers
  const [isHouseModalOpen, setIsHouseModalOpen] = useState(false);
  const [isTenantModalOpen, setIsTenantModalOpen] = useState(false);
  const [isPaymentModalOpen, setIsPaymentModalOpen] = useState(false);
  const [isRepairModalOpen, setIsRepairModalOpen] = useState(false);
  const [isBillingModalOpen, setIsBillingModalOpen] = useState(false);
  const [isResolveRepairModalOpen, setIsResolveRepairModalOpen] = useState(false);
  const [isHistoryModalOpen, setIsHistoryModalOpen] = useState(false);
  const [isSepticModalOpen, setIsSepticModalOpen] = useState(false);
  const [isWaterBillModalOpen, setIsWaterBillModalOpen] = useState(false);
  const [isEditTenantModalOpen, setIsEditTenantModalOpen] = useState(false);
  const [isExpenseModalOpen, setIsExpenseModalOpen] = useState(false);
  
  // Selection Targets
  const [selectedTenant, setSelectedTenant] = useState(null); 
  const [selectedTenantForDetails, setSelectedTenantForDetails] = useState(null); 
  const [selectedRepair, setSelectedRepair] = useState(null); 
  const workspaceId = userProfile?.workspaceId || (LEGACY_ROLE_BY_UID[user?.uid] ? DEFAULT_WORKSPACE_ID : user?.uid || '');

  useEffect(() => {
    localStorage.setItem('ruiru_theme', theme);
    document.documentElement.dataset.theme = theme;
  }, [theme]);

  // Authentication is intentionally role-agnostic in the client. The role is resolved
  // from a protected profile/custom claim instead of a hard-coded email allowlist.
  useEffect(() => {
    if (!auth) {
      setLoading(false);
      setLoginError('The portal is not configured yet. Add the Firebase values from .env.example.');
      return undefined;
    }

    const unsubscribe = onAuthStateChanged(auth, async (currentUser) => {
      if (currentUser) {
        try {
          const token = await getIdTokenResult(currentUser);
          const profileSnapshot = db ? await getDoc(doc(db, 'users', currentUser.uid)) : null;
          const profile = profileSnapshot?.exists() ? profileSnapshot.data() : {};
          const resolvedRole = normalizeRole(token.claims.role || profile.role || LEGACY_ROLE_BY_UID[currentUser.uid]);

          if (!resolvedRole) throw new Error('Account permissions could not be verified.');

          setUser(currentUser);
          setUserProfile({ ...profile, uid: currentUser.uid, workspaceId: profile.workspaceId || (LEGACY_ROLE_BY_UID[currentUser.uid] ? DEFAULT_WORKSPACE_ID : profile.workspaceId) });
          setRole(resolvedRole);
          setActiveTab('dashboard');
          if (db) {
            void addDoc(collection(db, 'artifacts', appId, 'public', 'data', 'auditLogs'), {
              workspaceId: profile.workspaceId || (LEGACY_ROLE_BY_UID[currentUser.uid] ? DEFAULT_WORKSPACE_ID : currentUser.uid),
              createdBy: currentUser.uid,
              updatedBy: currentUser.uid,
              actorId: currentUser.uid,
              actorRole: resolvedRole,
              action: 'LOGIN',
              entity: 'session',
              entityId: currentUser.uid,
              timestamp: new Date().toISOString(),
            });
          }
          setLoading(false);
        } catch {
          setLoginError('Your Firebase account was found, but it has no verified portal role. Create a users/{UID} profile with role LANDLORD or MANAGER, then sign in again.');
          await signOut(auth);
          setUser(null);
          setRole(null);
          setUserProfile(null);
          setLoading(false);
        }
      } else {
        setUser(null);
        setRole(null);
        setUserProfile(null);
        setLoading(false);
      }
    });
    return () => unsubscribe();
  }, []);

  useEffect(() => {
    if (!user || !db) return undefined;
    setDataError('');
    
    const getColRef = (colName) => {
      const ref = collection(db, 'artifacts', appId, 'public', 'data', colName);
      const isLegacyManager = role === ROLES.MANAGER && LEGACY_ROLE_BY_UID[user?.uid] === ROLES.MANAGER;
      return role === ROLES.MANAGER && !isLegacyManager ? query(ref, where('workspaceId', '==', workspaceId)) : ref;
    };
    const handleSnapshotError = () => setDataError('Some records could not be loaded. Check your connection or access permissions.');

    const unsubHouses = onSnapshot(getColRef('houses'), (snap) => {
        const fetchedHouses = snap.docs.map(d => ({ id: d.id, ...d.data() }));
        
        // Natural alphanumeric sort (e.g., "House 2" comes before "House 10")
        fetchedHouses.sort((a, b) => 
            (a.name || '').localeCompare((b.name || ''), undefined, { numeric: true, sensitivity: 'base' })
        );
        
        setHouses(fetchedHouses);
    }, handleSnapshotError);

    const unsubTenants = onSnapshot(getColRef('tenants'), (snap) => {
        setTenants(snap.docs.map(d => ({ id: d.id, ...d.data() })));
    }, handleSnapshotError);

    const unsubPayments = onSnapshot(getColRef('payments'), (snap) => {
      setPayments(snap.docs.map(d => ({ id: d.id, ...d.data() })).sort((a, b) => new Date(b.date) - new Date(a.date)));
    }, handleSnapshotError);

    const unsubRepairs = onSnapshot(getColRef('repairs'), (snap) => {
      setRepairs(snap.docs.map(d => ({ id: d.id, ...d.data() })).sort((a, b) => new Date(b.date) - new Date(a.date)));
    }, handleSnapshotError);

    const unsubSeptic = onSnapshot(getColRef('septicLogs'), (snap) => {
      setSepticLogs(snap.docs.map(d => ({ id: d.id, ...d.data() })).sort((a, b) => new Date(b.date) - new Date(a.date)));
    }, handleSnapshotError);

    const unsubWaterBills = onSnapshot(getColRef('masterWaterBills'), (snap) => {
      setMasterWaterBills(snap.docs.map(d => ({ id: d.id, ...d.data() })).sort((a, b) => new Date(b.date) - new Date(a.date)));
    }, handleSnapshotError);

    const unsubExpenses = onSnapshot(getColRef('expenses'), (snap) => {
      setExpenses(snap.docs.map(d => ({ id: d.id, ...d.data() })).sort((a, b) => new Date(b.date) - new Date(a.date)));
    }, handleSnapshotError);

    const unsubActivity = role === ROLES.LANDLORD
      ? onSnapshot(getColRef('auditLogs'), (snap) => {
        setActivityLogs(snap.docs.map(d => ({ id: d.id, ...d.data() })).sort((a, b) => new Date(b.timestamp) - new Date(a.timestamp)));
      }, handleSnapshotError)
      : () => {};

    const unsubNotifications = onSnapshot(getColRef('notifications'), (snap) => {
      setNotifications(snap.docs.map(d => ({ id: d.id, ...d.data() })).sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt)));
    }, handleSnapshotError);

    return () => { 
      unsubHouses(); unsubTenants(); unsubPayments();
      unsubRepairs(); unsubSeptic(); unsubWaterBills(); unsubExpenses();
      unsubActivity(); unsubNotifications();
    };
  }, [user, role, workspaceId]);

  // Derived occupancies
  const activeTenants = useMemo(() => tenants.filter(t => t.status !== 'ARCHIVED' && !t.archivedAt), [tenants]);
  const occupiedHouseIds = useMemo(() => {
    return new Set(activeTenants.map(t => t.houseId).filter(Boolean));
  }, [activeTenants]);

  const recordDefaults = () => ({ workspaceId, createdBy: user?.uid || '', updatedBy: user?.uid || '' });

  const recordAudit = async (action, entity, entityId, metadata = {}) => {
    if (!db || !user) return;
    await addDoc(collection(db, 'artifacts', appId, 'public', 'data', 'auditLogs'), {
      ...recordDefaults(),
      action,
      entity,
      entityId,
      actorId: user.uid,
      actorRole: role,
      timestamp: new Date().toISOString(),
      metadata,
    });
  };

  // Handle standard email password sign in
  const handleLoginSubmit = async (e) => {
    e.preventDefault();
    setLoginError('');
    if (!auth) {
      setLoginError('The portal is not configured yet. Add the Firebase values from .env.example.');
      return;
    }
    setIsProcessing(true);
    try {
      await signInWithEmailAndPassword(auth, email, password);
      triggerWelcome();
    } catch {
      setLoginError('Invalid credentials.');
    } finally {
      setIsProcessing(false);
    }
  };

  // Google Single-Sign On (SSO) Popup handler
  const handleGoogleSignIn = async () => {
    setLoginError('');
    if (!auth) {
      setLoginError('The portal is not configured yet. Add the Firebase values from .env.example.');
      return;
    }
    setIsProcessing(true);
    const provider = new GoogleAuthProvider();
    try {
      await signInWithPopup(auth, provider);
      triggerWelcome();
    } catch {
      setLoginError('Invalid credentials.');
      await signOut(auth);
    } finally {
      setIsProcessing(false);
    }
  };

  const triggerWelcome = () => {
    setShowWelcomeScreen(true);
    setTimeout(() => {
      setShowWelcomeScreen(false);
    }, 2500);
  };

  const handleForgotPassword = async () => {
    if (!auth || !email) {
      setLoginError('If an account matches that address, a reset link will be sent.');
      return;
    }
    setIsProcessing(true);
    try {
      await sendPasswordResetEmail(auth, email);
      setLoginError('If an account matches that address, a reset link will be sent.');
    } catch {
      // Do not disclose whether the email exists.
      setLoginError('If an account matches that address, a reset link will be sent.');
    } finally {
      setIsProcessing(false);
    }
  };

  const handleLogout = async () => {
    try {
      if (db && user) {
        await addDoc(collection(db, 'artifacts', appId, 'public', 'data', 'auditLogs'), {
          ...recordDefaults(), actorId: user.uid, actorRole: role, action: 'LOGOUT', entity: 'session', entityId: user.uid, timestamp: new Date().toISOString()
        });
      }
      if (auth) await signOut(auth);
      setRole(null);
      setUserProfile(null);
    } catch { setLoginError('Unable to sign out cleanly.'); }
  };

  const closeAnyModal = (setter) => {
    setter(false);
    setModalError('');
  };

  const formatKes = (amount) => new Intl.NumberFormat('en-KE', {
    style: 'currency',
    currency: DEFAULT_CURRENCY,
    maximumFractionDigits: 2,
  }).format(Number(amount || 0));

  // --- PROFESSIONAL PDF / PRINTING ENGINE ---
  const printReceipt = (payment, tenant) => {
    const printWindow = window.open('', '_blank');
    if (!printWindow) {
      setModalError('Allow pop-ups to print a receipt.');
      return;
    }
    const house = houses.find(h => h.id === tenant.houseId);
    const houseName = house ? house.name : 'Unassigned';
    
    // Get the base URL to ensure the logo loads properly in the print window
    const baseUrl = window.location.origin;

    const html = `
      <!DOCTYPE html>
      <html>
        <head>
          <title>Receipt - ${escapeHtml(payment.messageCode || 'N/A')}</title>
          <style>
            @media print {
              body { -webkit-print-color-adjust: exact; print-color-adjust: exact; }
            }
            body { 
              font-family: 'Helvetica Neue', Helvetica, Arial, sans-serif; 
              padding: 40px; 
              color: #333; 
              max-width: 800px; 
              margin: 0 auto; 
              position: relative; 
              background: #fff;
            }
            /* Dark Green Watermark */
            .watermark { 
              position: fixed; 
              top: 50%; 
              left: 50%; 
              transform: translate(-50%, -50%) rotate(-35deg); 
              opacity: 0.08; 
              font-size: 110px; 
              font-weight: 900; 
              z-index: -1; 
              pointer-events: none; 
              white-space: nowrap; 
              color: #064e3b; /* Tailwind emerald-900 */
              text-transform: uppercase;
              letter-spacing: 4px;
            }
            .header-container {
              display: flex;
              justify-content: space-between;
              align-items: center;
              border-bottom: 2px solid #e2e8f0;
              padding-bottom: 25px;
              margin-bottom: 30px;
            }
            .logo-area img {
              width: 80px;
              height: 80px;
              border-radius: 12px;
              object-fit: cover;
              border: 1px solid #e2e8f0;
            }
            .header-text { text-align: right; }
            .header-text h1 { margin: 0; font-size: 28px; color: #0f172a; font-weight: 800; letter-spacing: -0.5px; }
            .header-text p { margin: 5px 0 0; color: #64748b; font-weight: 600; font-size: 14px; text-transform: uppercase; letter-spacing: 1px; }
            
            .amount-box { 
              background: #f8fafc; 
              padding: 25px; 
              border-radius: 16px; 
              text-align: center; 
              border: 1px solid #e2e8f0; 
              margin-bottom: 35px; 
            }
            .amount-box p { margin: 0 0 8px; color: #64748b; text-transform: uppercase; font-size: 12px; font-weight: bold; letter-spacing: 1px; }
            .amount-box h2 { margin: 0; font-size: 42px; color: #059669; font-family: monospace; font-weight: 900; }
            
            .details { display: flex; justify-content: space-between; margin-bottom: 35px; background: #fff; border: 1px solid #e2e8f0; border-radius: 12px; padding: 20px; }
            .details div { font-size: 14px; line-height: 1.8; color: #475569; }
            .details strong { color: #0f172a; font-size: 15px; }
            
            table { width: 100%; border-collapse: collapse; margin-bottom: 40px; border: 1px solid #e2e8f0; border-radius: 12px; overflow: hidden; }
            th, td { border-bottom: 1px solid #e2e8f0; padding: 16px; text-align: left; }
            th { color: #64748b; font-weight: bold; font-size: 12px; text-transform: uppercase; background: #f8fafc; letter-spacing: 0.5px; }
            td { font-size: 15px; color: #1e293b; font-weight: 500; }
            
            .footer { font-size: 13px; text-align: center; color: #94a3b8; border-top: 2px solid #e2e8f0; padding-top: 25px; margin-top: 50px; }
            .footer p { margin: 5px 0; }
            .signature { font-weight: bold; color: #cbd5e1; margin-top: 15px !important; font-size: 11px; }
          </style>
        </head>
        <body>
          <div class="watermark">RUIRU RENTALS</div>
          
          <div class="header-container">
            <div class="logo-area">
              <img src="${baseUrl}/HSlogo.png" alt="Ruiru Rentals Logo" onerror="this.style.display='none'">
            </div>
            <div class="header-text">
              <h1>Ruiru Rentals</h1>
              <p>Official Payment Receipt</p>
            </div>
          </div>

          <div class="amount-box">
            <p>Total Amount Received</p>
            <h2>${formatKes(payment.amount)}</h2>
          </div>

          <div class="details">
            <div>
              <strong>Tenant Details:</strong><br/>
              Name: <span style="font-weight: 600;">${escapeHtml(tenant.name)}</span><br/>
              Unit/House: <span style="font-weight: 800; color: #0f172a;">${escapeHtml(houseName)}</span><br/>
              Phone: ${escapeHtml(tenant.phone)}
            </div>
            <div style="text-align: right;">
              <strong>Transaction Info:</strong><br/>
              Date: <span style="font-weight: 600;">${new Date(payment.date).toLocaleString()}</span><br/>
              Method: ${escapeHtml(payment.method)}<br/>
              Ref Code: <span style="font-family: monospace; font-weight: bold; background: #f1f5f9; padding: 2px 6px; border-radius: 4px;">${escapeHtml(payment.messageCode || 'N/A')}</span>
            </div>
          </div>

          <table>
            <thead>
              <tr>
                <th>Description of Payment</th>
                <th style="text-align: right;">Amount Applied</th>
              </tr>
            </thead>
            <tbody>
              <tr>
                <td>${escapeHtml(payment.type === 'COMBINED' ? 'Rent & Water Combined Payment' : payment.type + ' Payment')}</td>
                <td style="text-align: right; font-family: monospace; font-weight: bold; font-size: 16px;">${formatKes(payment.amount)}</td>
              </tr>
            </tbody>
          </table>

          <div class="footer">
            <p style="font-weight: bold; color: #475569; font-size: 15px;">Thank you for your prompt payment!</p>
            <p>This is a system-generated receipt. No signature is required.</p>
            <p class="signature">&copy; ${new Date().getFullYear()} Ruiru Rentals. @Gikunju creates.</p>
          </div>
        </body>
      </html>
    `;
    printWindow.document.write(html);
    printWindow.document.close();
    setTimeout(() => printWindow.print(), 500);
  };

  const printLedgerReport = () => {
    const printWindow = window.open('', '_blank');
    if (!printWindow) {
      setModalError('Allow pop-ups to print the ledger.');
      return;
    }
    const baseUrl = window.location.origin;

    const html = `
      <!DOCTYPE html>
      <html>
        <head>
          <title>Ruiru Rentals - Ledger Report</title>
          <style>
            @media print {
              body { -webkit-print-color-adjust: exact; print-color-adjust: exact; }
            }
            body { font-family: 'Helvetica Neue', Helvetica, Arial, sans-serif; padding: 40px; color: #333; position: relative; font-size: 14px; background: #fff; }
            
            /* Dark Green Watermark */
            .watermark { position: fixed; top: 50%; left: 50%; transform: translate(-50%, -50%) rotate(-35deg); opacity: 0.05; font-size: 160px; font-weight: 900; z-index: -1; pointer-events: none; white-space: nowrap; color: #064e3b; text-transform: uppercase; }
            
            .header-container { display: flex; justify-content: space-between; align-items: center; border-bottom: 2px solid #e2e8f0; padding-bottom: 25px; margin-bottom: 30px; }
            .logo-area img { width: 70px; height: 70px; border-radius: 12px; object-fit: cover; }
            .header-text { text-align: right; }
            .header-text h1 { margin: 0; font-size: 26px; color: #0f172a; }
            .header-text p { margin: 5px 0 0; color: #64748b; font-weight: 600; font-size: 12px; text-transform: uppercase; }
            
            table { width: 100%; border-collapse: collapse; margin-top: 20px; font-size: 13px; }
            th, td { border: 1px solid #e2e8f0; padding: 12px; text-align: left; }
            th { background-color: #f8fafc; color: #475569; text-transform: uppercase; font-size: 11px; font-weight: bold; letter-spacing: 0.5px; }
            td { color: #1e293b; }
            
            .badge { padding: 4px 8px; border-radius: 6px; font-size: 10px; font-weight: bold; background: #e2e8f0; color: #475569; text-transform: uppercase; }
            .badge-confirmed { background: #d1fae5; color: #065f46; }
            
            .footer { margin-top: 50px; font-size: 12px; text-align: center; color: #94a3b8; border-top: 2px solid #e2e8f0; padding-top: 20px; }
          </style>
        </head>
        <body>
          <div class="watermark">RUIRU RENTALS</div>
          
          <div class="header-container">
            <div class="logo-area">
              <img src="${baseUrl}/HSlogo.png" alt="Logo" onerror="this.style.display='none'">
            </div>
            <div class="header-text">
              <h1>Ruiru Rentals</h1>
              <p>Full Transactions Ledger Report</p>
              <p style="font-size: 11px; color: #94a3b8; margin-top: 8px;">Generated on: ${new Date().toLocaleString()}</p>
            </div>
          </div>

          <table>
            <thead>
              <tr>
                <th>Date</th>
                <th>Tenant Name</th>
                <th>Ref Code</th>
                <th>Type</th>
                <th>Amount</th>
                <th>Status</th>
              </tr>
            </thead>
            <tbody>
              ${payments.map(p => `
                <tr>
                  <td>${new Date(p.date).toLocaleDateString()}</td>
                  <td><strong>${escapeHtml(p.tenantName)}</strong></td>
                  <td style="font-family: monospace;">${escapeHtml(p.messageCode || 'N/A')}</td>
                  <td>${escapeHtml(p.type === 'COMBINED' ? 'Rent & Water' : p.type)}</td>
                  <td style="font-family: monospace; font-weight: bold; font-size: 14px;">${formatKes(p.amount)}</td>
                  <td><span class="badge ${p.status === 'CONFIRMED' ? 'badge-confirmed' : ''}">${escapeHtml(p.status)}</span></td>
                </tr>
              `).join('')}
            </tbody>
          </table>

          <div class="footer">
            <p>&copy; ${new Date().getFullYear()} Ruiru Rentals. All rights reserved.</p>
            <p style="margin-top: 10px; font-weight: bold; color: #cbd5e1; font-size: 10px;">@Gikunju creates</p>
          </div>
        </body>
      </html>
    `;
    printWindow.document.write(html);
    printWindow.document.close();
    setTimeout(() => printWindow.print(), 500);
  };

  // --- REBUILT IMMUNE CRUD OPERATIONS ---
  const handleAddHouse = async (e) => {
    e.preventDefault();
    if (!user || !db || isProcessing) return;
    setIsProcessing(true);
    setModalError('');
    try {
      const formData = new FormData(e.target);
      const rawHouseName = formData.get('name').trim();
      const rent = parseMoney(formData.get('rent'), { allowZero: true });

      if (!rawHouseName) throw new Error("Unit name cannot be blank.");
      if (houses.some(h => h.name.trim().toLowerCase() === rawHouseName.toLowerCase())) {
        throw new Error(`A unit named "${rawHouseName}" already exists in your inventory.`);
      }

      const addPromise = addDoc(collection(db, 'artifacts', appId, 'public', 'data', 'houses'), {
        ...recordDefaults(),
        name: rawHouseName, type: formData.get('type'), rent,
        status: 'VACANT', repairStatus: 'GOOD', createdAt: new Date().toISOString()
      });
      const created = await promiseTimeout(addPromise, 5000);
      await recordAudit('UNIT_CREATED', 'unit', created.id, { name: rawHouseName });
      closeAnyModal(setIsHouseModalOpen);
    } catch (err) { setModalError(err.message); } finally { setIsProcessing(false); }
  };

  const handleToggleHouseRepairMode = async (house) => {
    if (!user || !db || isProcessing) return;
    setIsProcessing(true);
    try {
      const newStatus = house.status === 'UNDER_REPAIR' ? 'VACANT' : 'UNDER_REPAIR';
      const updatePromise = updateDoc(doc(db, 'artifacts', appId, 'public', 'data', 'houses', house.id), { status: newStatus, updatedBy: user.uid, updatedAt: new Date().toISOString() });
      await promiseTimeout(updatePromise, 5000);
      await recordAudit('UNIT_STATUS_CHANGED', 'unit', house.id, { status: newStatus });
    } catch (err) { setModalError(err.message); } finally { setIsProcessing(false); }
  };

  const handleAddTenant = async (e) => {
    e.preventDefault();
    if (!user || !db || isProcessing) return;
    setIsProcessing(true);
    setModalError('');
    try {
      const formData = new FormData(e.target);
      const houseId = formData.get('houseId');
      const expectedRent = parseMoney(formData.get('expectedRent'), { allowZero: true });
      const expectedWater = parseMoney(formData.get('expectedWater'), { allowZero: true });
      
      if (!houseId) throw new Error("Please select an available vacant house unit.");
      if (occupiedHouseIds.has(houseId)) throw new Error("That house unit has just been occupied.");

      const tenantRef = doc(collection(db, 'artifacts', appId, 'public', 'data', 'tenants'));
      await promiseTimeout(runTransaction(db, async (transaction) => {
        const houseRef = doc(db, 'artifacts', appId, 'public', 'data', 'houses', houseId);
        const houseSnapshot = await transaction.get(houseRef);
        if (!houseSnapshot.exists() || houseSnapshot.data().status === 'ARCHIVED') throw new Error('That unit is no longer available.');
        transaction.set(tenantRef, {
          ...recordDefaults(),
          name: formData.get('name').trim(), phone: formData.get('phone').trim(), contactPref: formData.get('contactPref'),
          houseId, expectedRent, expectedWater, paidRent: 0, paidWater: 0,
          status: 'ACTIVE', dateEntered: new Date().toISOString(), createdAt: new Date().toISOString()
        });
        transaction.update(houseRef, { status: 'OCCUPIED', updatedBy: user.uid, updatedAt: new Date().toISOString() });
      }), 5000);
      await recordAudit('TENANT_CREATED', 'tenant', tenantRef.id, { houseId });
      closeAnyModal(setIsTenantModalOpen);
    } catch (err) { setModalError(err.message); } finally { setIsProcessing(false); }
  };

  const handleEditTenant = async (e) => {
    e.preventDefault();
    if (!user || !db || role !== ROLES.LANDLORD || !selectedTenantForDetails || isProcessing) return;
    setIsProcessing(true);
    setModalError('');
    try {
      const formData = new FormData(e.target);
      const newHouseId = formData.get('houseId');
      const oldHouseId = selectedTenantForDetails.houseId;
      const expectedRent = parseMoney(formData.get('expectedRent'), { allowZero: true });
      const expectedWater = parseMoney(formData.get('expectedWater'), { allowZero: true });

      if (newHouseId && newHouseId !== oldHouseId) {
         if (occupiedHouseIds.has(newHouseId)) throw new Error("Target house unit is already occupied.");
      }

      await promiseTimeout(runTransaction(db, async (transaction) => {
        const tenantRef = doc(db, 'artifacts', appId, 'public', 'data', 'tenants', selectedTenantForDetails.id);
        const tenantSnapshot = await transaction.get(tenantRef);
        if (!tenantSnapshot.exists() || tenantSnapshot.data().status === 'ARCHIVED') throw new Error('This tenant record is no longer active.');
        if (newHouseId && newHouseId !== oldHouseId) {
          const newHouseRef = doc(db, 'artifacts', appId, 'public', 'data', 'houses', newHouseId);
          const oldHouseRef = oldHouseId ? doc(db, 'artifacts', appId, 'public', 'data', 'houses', oldHouseId) : null;
          const newHouseSnapshot = await transaction.get(newHouseRef);
          if (!newHouseSnapshot.exists() || newHouseSnapshot.data().status === 'ARCHIVED') throw new Error('Target unit is no longer available.');
          transaction.update(newHouseRef, { status: 'OCCUPIED', updatedBy: user.uid, updatedAt: new Date().toISOString() });
          if (oldHouseRef) transaction.update(oldHouseRef, { status: 'VACANT', updatedBy: user.uid, updatedAt: new Date().toISOString() });
        }
        transaction.update(tenantRef, {
          name: formData.get('name').trim(), phone: formData.get('phone').trim(), contactPref: formData.get('contactPref'),
          expectedRent, expectedWater, houseId: newHouseId || oldHouseId,
          updatedBy: user.uid, updatedAt: new Date().toISOString()
        });
      }), 5000);
      await recordAudit('TENANT_UPDATED', 'tenant', selectedTenantForDetails.id, { houseId: newHouseId || oldHouseId });
      closeAnyModal(setIsEditTenantModalOpen);
      setSelectedTenantForDetails(null);
    } catch (err) { setModalError(err.message); } finally { setIsProcessing(false); }
  };

  const handleLogPayment = async (e) => {
    e.preventDefault();
    if (!user || !db || !selectedTenant || isProcessing) return;
    setIsProcessing(true);
    setModalError('');
    try {
      const formData = new FormData(e.target);
      const amount = parseMoney(formData.get('amount'));
      const type = formData.get('type');
      const messageCode = formData.get('messageCode').trim().toUpperCase();
      const method = formData.get('method');

      const paymentRef = doc(collection(db, 'artifacts', appId, 'public', 'data', 'payments'));
      const referenceRef = messageCode && method !== 'CASH' && messageCode !== 'N/A'
        ? doc(db, 'artifacts', appId, 'public', 'data', 'paymentReferences', encodeURIComponent(messageCode))
        : null;
      const isConfirmed = role === ROLES.LANDLORD;

      await promiseTimeout(runTransaction(db, async (transaction) => {
        const tenantRef = doc(db, 'artifacts', appId, 'public', 'data', 'tenants', selectedTenant.id);
        const tenantSnapshot = await transaction.get(tenantRef);
        const referenceSnapshot = referenceRef ? await transaction.get(referenceRef) : null;
        if (!tenantSnapshot.exists() || tenantSnapshot.data().status === 'ARCHIVED') throw new Error('This tenant record is no longer active.');
        if (referenceSnapshot?.exists()) throw new Error('That payment reference has already been recorded.');

        const currentTenant = tenantSnapshot.data();
        const allocation = allocatePayment(
          amount,
          type,
          Number(currentTenant.expectedRent || 0) - Number(currentTenant.paidRent || 0),
          Number(currentTenant.expectedWater || 0) - Number(currentTenant.paidWater || 0)
        );
        const now = new Date().toISOString();
        transaction.set(paymentRef, {
          ...recordDefaults(),
          tenantId: selectedTenant.id, tenantName: currentTenant.name,
          amount, appliedRent: isConfirmed ? allocation.appliedRent : 0,
          appliedWater: isConfirmed ? allocation.appliedWater : 0,
          excessAmount: isConfirmed ? allocation.excessAmount : 0,
          pendingAllocation: isConfirmed ? null : allocation,
          type, method, messageCode, status: isConfirmed ? 'CONFIRMED' : 'PENDING',
          date: now, createdAt: now, loggedBy: role, loggedByUserId: user.uid
        });
        if (referenceRef) transaction.set(referenceRef, { ...recordDefaults(), paymentId: paymentRef.id, reference: messageCode, createdAt: now });
        if (isConfirmed) {
          transaction.update(tenantRef, {
            paidRent: Number(currentTenant.paidRent || 0) + allocation.appliedRent,
            paidWater: Number(currentTenant.paidWater || 0) + allocation.appliedWater,
            updatedBy: user.uid, updatedAt: now
          });
        }
      }), 5000);
      await recordAudit('PAYMENT_RECORDED', 'payment', paymentRef.id, { tenantId: selectedTenant.id, amount, status: isConfirmed ? 'CONFIRMED' : 'PENDING' });

      closeAnyModal(setIsPaymentModalOpen);
      setSelectedTenant(null);
    } catch (err) { setModalError(err.message); } finally { setIsProcessing(false); }
  };

  const handleConfirmPayment = async (payment) => {
    if (!user || !db || role !== ROLES.LANDLORD || isProcessing) return;
    setIsProcessing(true);
    try {
      const paymentRef = doc(db, 'artifacts', appId, 'public', 'data', 'payments', payment.id);
      const tenantRef = doc(db, 'artifacts', appId, 'public', 'data', 'tenants', payment.tenantId);
      await promiseTimeout(runTransaction(db, async (transaction) => {
        const paymentSnapshot = await transaction.get(paymentRef);
        const tenantSnapshot = await transaction.get(tenantRef);
        if (!paymentSnapshot.exists() || paymentSnapshot.data().status !== 'PENDING') throw new Error('This payment has already been reviewed.');
        if (!tenantSnapshot.exists() || tenantSnapshot.data().status === 'ARCHIVED') throw new Error('Tenant is no longer in the directory.');
        const currentPayment = paymentSnapshot.data();
        const currentTenant = tenantSnapshot.data();
        const allocation = allocatePayment(
          currentPayment.amount,
          currentPayment.type,
          Number(currentTenant.expectedRent || 0) - Number(currentTenant.paidRent || 0),
          Number(currentTenant.expectedWater || 0) - Number(currentTenant.paidWater || 0)
        );
        const now = new Date().toISOString();
        transaction.update(paymentRef, { status: 'CONFIRMED', ...allocation, reviewedBy: user.uid, reviewedAt: now, updatedBy: user.uid, updatedAt: now });
        transaction.update(tenantRef, {
          paidRent: Number(currentTenant.paidRent || 0) + allocation.appliedRent,
          paidWater: Number(currentTenant.paidWater || 0) + allocation.appliedWater,
          updatedBy: user.uid, updatedAt: now
        });
      }), 5000);
      await recordAudit('PAYMENT_CONFIRMED', 'payment', payment.id, { tenantId: payment.tenantId, amount: payment.amount });
    } catch (err) { setModalError(err.message); } finally { setIsProcessing(false); }
  };

  const handleAddExpense = async (e) => {
    e.preventDefault();
    if (!user || !db || isProcessing) return;
    setIsProcessing(true);
    setModalError('');
    try {
      const formData = new FormData(e.target);
      const amount = parseMoney(formData.get('amount'));
      const date = formData.get('date') || new Date().toISOString().slice(0, 10);
      const created = await promiseTimeout(addDoc(collection(db, 'artifacts', appId, 'public', 'data', 'expenses'), {
        ...recordDefaults(),
        category: formData.get('category'), description: formData.get('description').trim(), amount,
        date, paymentMethod: formData.get('paymentMethod'), vendor: formData.get('vendor').trim(),
        status: role === ROLES.LANDLORD ? 'APPROVED' : 'PENDING',
        recordedBy: user.uid, createdAt: new Date().toISOString()
      }), 5000);
      await recordAudit('EXPENSE_CREATED', 'expense', created.id, { amount, category: formData.get('category') });
      closeAnyModal(setIsExpenseModalOpen);
    } catch (err) { setModalError(err.message); } finally { setIsProcessing(false); }
  };

  const handleLogRepair = async (e) => {
    e.preventDefault();
    if (!user || !db || isProcessing) return;
    setIsProcessing(true);
    try {
      const formData = new FormData(e.target);
      const houseId = formData.get('houseId');
      const repairPromise = addDoc(collection(db, 'artifacts', appId, 'public', 'data', 'repairs'), {
        ...recordDefaults(),
        description: formData.get('description').trim(), houseId, status: 'OPEN', cost: 0,
        date: new Date().toISOString(), createdAt: new Date().toISOString(), loggedBy: role, loggedByUserId: user.uid
      });
      const created = await promiseTimeout(repairPromise, 5000);
      await promiseTimeout(updateDoc(doc(db, 'artifacts', appId, 'public', 'data', 'houses', houseId), { repairStatus: 'NEEDS_REPAIR', updatedBy: user.uid, updatedAt: new Date().toISOString() }), 5000);
      await recordAudit('MAINTENANCE_CREATED', 'maintenance', created.id, { houseId });
      closeAnyModal(setIsRepairModalOpen);
    } catch(err) { setModalError(err.message); } finally { setIsProcessing(false); }
  };

  const handleResolveRepairSubmit = async (e) => {
    e.preventDefault();
    if (!user || !db || !selectedRepair || isProcessing) return;
    setIsProcessing(true);
    try {
      const cost = parseMoney(new FormData(e.target).get('cost'), { allowZero: true });
      const now = new Date().toISOString();
      await promiseTimeout(runTransaction(db, async (transaction) => {
        const repairRef = doc(db, 'artifacts', appId, 'public', 'data', 'repairs', selectedRepair.id);
        const houseRef = doc(db, 'artifacts', appId, 'public', 'data', 'houses', selectedRepair.houseId);
        const repairSnapshot = await transaction.get(repairRef);
        if (!repairSnapshot.exists() || repairSnapshot.data().status !== 'OPEN') throw new Error('This maintenance ticket has already been updated.');
        transaction.update(repairRef, { status: 'RESOLVED', cost, resolvedAt: now, updatedBy: user.uid, updatedAt: now });
        transaction.update(houseRef, { repairStatus: 'GOOD', updatedBy: user.uid, updatedAt: now });
      }), 5000);
      await recordAudit('MAINTENANCE_COMPLETED', 'maintenance', selectedRepair.id, { cost });
      closeAnyModal(setIsResolveRepairModalOpen);
      setSelectedRepair(null);
    } catch (err) { setModalError(err.message); } finally { setIsProcessing(false); }
  };

  const handleLogSeptic = async (e) => {
    e.preventDefault();
    if (!user || !db || isProcessing) return;
    setIsProcessing(true);
    try {
      const optionRaw = new FormData(e.target).get('provider');
      const [provider, costStr] = optionRaw.split('|');
      const created = await promiseTimeout(addDoc(collection(db, 'artifacts', appId, 'public', 'data', 'septicLogs'), {
        ...recordDefaults(), provider, cost: parseMoney(costStr, { allowZero: true }), date: new Date().toISOString(), loggedBy: role
      }), 5000);
      await recordAudit('EXPENSE_CREATED', 'septic', created.id, { provider, cost: Number(costStr) });
      closeAnyModal(setIsSepticModalOpen);
    } catch(err) { setModalError(err.message); } finally { setIsProcessing(false); }
  };

  const handleLogWaterBill = async (e) => {
    e.preventDefault();
    if (!user || !db || isProcessing) return;
    setIsProcessing(true);
    try {
      const formData = new FormData(e.target);
      const amount = parseMoney(formData.get('amount'));
      const created = await promiseTimeout(addDoc(collection(db, 'artifacts', appId, 'public', 'data', 'masterWaterBills'), {
        ...recordDefaults(), month: formData.get('month').trim(), amount, date: new Date().toISOString(), loggedBy: role
      }), 5000);
      await recordAudit('UTILITY_BILL_CREATED', 'utility_bill', created.id, { amount });
      closeAnyModal(setIsWaterBillModalOpen);
    } catch (err) { setModalError(err.message); } finally { setIsProcessing(false); }
  };

  const handleUpdateBills = async (e) => {
    e.preventDefault();
    if (!user || !db || !selectedTenant || isProcessing) return;
    setIsProcessing(true);
    try {
      const formData = new FormData(e.target);
      const addRent = parseMoney(formData.get('addRent'), { allowZero: true });
      const addWater = parseMoney(formData.get('addWater'), { allowZero: true });
      await promiseTimeout(updateDoc(doc(db, 'artifacts', appId, 'public', 'data', 'tenants', selectedTenant.id), {
        expectedRent: Number(selectedTenant.expectedRent || 0) + addRent,
        expectedWater: Number(selectedTenant.expectedWater || 0) + addWater,
        updatedBy: user.uid, updatedAt: new Date().toISOString(), lastAdjustment: { addRent, addWater, by: user.uid, at: new Date().toISOString() }
      }), 5000);
      await recordAudit('TENANT_CHARGES_ADJUSTED', 'tenant', selectedTenant.id, { addRent, addWater });
      closeAnyModal(setIsBillingModalOpen);
      setSelectedTenant(null);
    } catch (err) { setModalError(err.message); } finally { setIsProcessing(false); }
  };

  const handleDeleteTenant = async (tenant) => {
    if (!user || !db || role !== ROLES.LANDLORD || !tenant || isProcessing) return;
    if (window.confirm(`Archive ${tenant.name}'s record? Financial history will remain available for audit.`)) {
       setIsProcessing(true);
       try {
         await promiseTimeout(runTransaction(db, async (transaction) => {
           const tenantRef = doc(db, 'artifacts', appId, 'public', 'data', 'tenants', tenant.id);
           const tenantSnapshot = await transaction.get(tenantRef);
           if (!tenantSnapshot.exists()) throw new Error('Tenant record no longer exists.');
           transaction.update(tenantRef, { status: 'ARCHIVED', archivedAt: new Date().toISOString(), archivedBy: user.uid, updatedBy: user.uid });
           if (tenant.houseId) transaction.update(doc(db, 'artifacts', appId, 'public', 'data', 'houses', tenant.houseId), { status: 'VACANT', updatedBy: user.uid, updatedAt: new Date().toISOString() });
         }), 5000);
         await recordAudit('TENANT_ARCHIVED', 'tenant', tenant.id, { houseId: tenant.houseId });
         setSelectedTenantForDetails(null);
       } catch (err) { setModalError(err.message || 'Could not archive tenant safely.'); } finally { setIsProcessing(false); }
    }
  };

  // --- REBUILT ACCOUNTING MATH ENGINE ---
  const stats = useMemo(() => {
    let collectedRentRev = 0, collectedWaterRev = 0, totalJosephBonus = 0, pendingPaymentsCount = 0;
    let totalRepairExpenses = 0, totalSepticExpenses = 0, totalMasterWaterBills = 0;

    payments.forEach(p => {
      if (p.status === 'CONFIRMED') {
        collectedRentRev += (p.appliedRent || 0);
        collectedWaterRev += (p.appliedWater || 0);
        if (p.excessAmount) totalJosephBonus += p.excessAmount;
      }
      if (p.status === 'PENDING') pendingPaymentsCount++;
    });

    let activeRentArrears = 0, activeWaterArrears = 0;
    activeTenants.forEach(t => {
      const rBal = (t.expectedRent || 0) - (t.paidRent || 0);
      const wBal = (t.expectedWater || 0) - (t.paidWater || 0);
      if (rBal > 0) activeRentArrears += rBal;
      if (wBal > 0) activeWaterArrears += wBal;
    });

    const expectedRentRev = collectedRentRev + activeRentArrears;
    const expectedWaterRev = collectedWaterRev + activeWaterArrears;

    repairs.forEach(r => { if (r.status === 'RESOLVED' && r.cost) totalRepairExpenses += r.cost; });
    septicLogs.forEach(s => { if (s.cost) totalSepticExpenses += s.cost; });
    masterWaterBills.forEach(m => { if (m.amount) totalMasterWaterBills += m.amount; });
    const waterReserve = collectedWaterRev - totalMasterWaterBills;
    const occupiedUnits = houses.filter(h => h.status === 'OCCUPIED' || occupiedHouseIds.has(h.id)).length;
    const totalOperatingExpensesWithRecords = totalRepairExpenses + totalSepticExpenses + expenses
      .filter(expense => expense.status !== 'REJECTED')
      .reduce((sum, expense) => sum + Number(expense.amount || 0), 0);

    return {
      expectedRentRev, collectedRentRev, expectedWaterRev, collectedWaterRev,
      pendingPaymentsCount, totalJosephBonus, totalOperatingExpenses: totalOperatingExpensesWithRecords, totalMasterWaterBills, waterReserve,
      vacantHouses: houses.filter(h => h.status === 'VACANT' && !occupiedHouseIds.has(h.id)).length,
      openRepairs: repairs.filter(r => r.status === 'OPEN').length,
      totalRepairExpenses, totalSepticExpenses, totalUnits: houses.length, occupiedUnits,
      occupancyRate: houses.length ? Math.round((occupiedUnits / houses.length) * 100) : 0,
      netOperatingResult: collectedRentRev - totalOperatingExpensesWithRecords,
    };
  }, [activeTenants, houses, repairs, payments, septicLogs, masterWaterBills, expenses, occupiedHouseIds]);

  const tenantPaymentHistory = useMemo(() => {
    if (!selectedTenant) return [];
    return payments.filter(p => p.tenantId === selectedTenant.id && p.status === 'CONFIRMED');
  }, [selectedTenant, payments]);

  const normalizedSearch = globalSearch.trim().toLowerCase();
  const filteredHouses = useMemo(() => houses.filter(house => !normalizedSearch || `${house.name} ${house.type}`.toLowerCase().includes(normalizedSearch)), [houses, normalizedSearch]);
  const filteredTenants = useMemo(() => activeTenants.filter(tenant => {
    const house = houses.find(h => h.id === tenant.houseId);
    return !normalizedSearch || `${tenant.name} ${tenant.phone} ${house?.name || ''}`.toLowerCase().includes(normalizedSearch);
  }), [activeTenants, houses, normalizedSearch]);
  const filteredPayments = useMemo(() => payments.filter(payment => !normalizedSearch || `${payment.tenantName} ${payment.messageCode || ''} ${payment.type} ${payment.method}`.toLowerCase().includes(normalizedSearch)), [payments, normalizedSearch]);
  const filteredRepairs = useMemo(() => repairs.filter(repair => !normalizedSearch || `${repair.description} ${houses.find(h => h.id === repair.houseId)?.name || ''}`.toLowerCase().includes(normalizedSearch)), [repairs, houses, normalizedSearch]);

  const can = (permission) => hasPermission(role, permission, userProfile?.permissions);
  const paymentMethods = userProfile?.paymentMethods || ['M-Pesa', 'Bank Transfer', 'Cash', 'Other'];

  const navItems = [
    { id: 'dashboard', label: 'Dashboard', icon: LayoutDashboard, permission: PERMISSIONS.VIEW_DASHBOARD },
    { id: 'houses', label: 'Houses & Units', icon: Building2, permission: PERMISSIONS.VIEW_PROPERTIES },
    { id: 'tenants', label: 'Tenants', icon: Users, permission: PERMISSIONS.VIEW_TENANTS },
    { id: 'billing', label: 'Rent & Payments', icon: Wallet, permission: PERMISSIONS.VIEW_RENT, badge: stats.pendingPaymentsCount },
    { id: 'expenses', label: 'Expenses', icon: ReceiptText, permission: PERMISSIONS.VIEW_EXPENSES },
    { id: 'repairs', label: 'Maintenance', icon: Wrench, permission: PERMISSIONS.VIEW_MAINTENANCE, badge: stats.openRepairs },
    { id: 'utilities', label: 'Utilities', icon: Droplet, permission: PERMISSIONS.VIEW_EXPENSES },
    { id: 'reports', label: 'Reports', icon: FileBarChart, permission: PERMISSIONS.VIEW_REPORTS },
    { id: 'activity', label: 'Activity', icon: Activity, permission: PERMISSIONS.VIEW_REPORTS },
    { id: 'settings', label: 'Settings', icon: Settings, permission: PERMISSIONS.MANAGE_SETTINGS },
  ];


  if (loading) {
    return (
      <div className={`min-h-screen flex flex-col gap-4 items-center justify-center ${theme === 'dark' ? 'bg-slate-950' : 'bg-[#FDFBF7]'}`}>
        <div className={`animate-spin rounded-full h-12 w-12 border-4 border-t-transparent shadow-lg ${theme === 'dark' ? 'border-slate-400' : 'border-gray-800'}`}></div>
        <p className={`font-bold text-sm tracking-widest uppercase opacity-80 animate-pulse ${theme === 'dark' ? 'text-slate-400' : 'text-gray-500'}`}>Ruiru Rentals Syncing...</p>
      </div>
    );
  }

  // --- WELCOME BACK ANIMATION ---
  if (user && showWelcomeScreen) {
    return (
      <div className={`min-h-screen flex flex-col items-center justify-center transition-all duration-500 ${theme === 'dark' ? 'bg-slate-950 text-white' : 'bg-[#FDFBF7] text-gray-900'}`}>
        <div className="animate-bounce mb-6">
          <CheckCircle2 size={72} className="text-emerald-500"/>
        </div>
        <h1 className="text-4xl md:text-5xl font-extrabold mb-3 animate-pulse text-center px-4">Welcome Back!</h1>
        <p className="text-gray-500 font-medium text-lg">Preparing your secure workspace...</p>
      </div>
    );
  }

  if (!user) {
    return (
      <div 
        className={`min-h-screen flex flex-col items-center justify-center p-4 relative ${theme === 'dark' ? 'dark' : ''}`} 
        style={{ backgroundImage: "url('/HSlogo.png')", backgroundSize: 'cover', backgroundPosition: 'center' }}
      >
        <div className="absolute inset-0 bg-black/70 backdrop-blur-[2px] z-0"></div>
        
        <div className="bg-slate-900/95 max-w-md w-full rounded-2xl shadow-2xl p-8 border border-gray-800 transition-all z-10 relative">
          <img src="/HSlogo.png" alt="HSE Logo" className="w-20 h-20 rounded-xl object-cover mx-auto mb-4 shadow-lg border border-gray-700" />
          <h1 className="text-2xl font-bold text-white text-center mb-1 font-mono tracking-wide">Ruiru Rentals</h1>
          <p className="text-gray-400 text-xs text-center mb-6">Secured Tenant & Property Portal</p>

          <div className="flex border-b border-gray-800 mb-6">
            <button 
              type="button" 
              onClick={() => { setLoginTab('landlord'); setEmail(''); setPassword(''); setLoginError(''); }}
              className={`flex-1 pb-3 text-xs font-bold border-b-2 transition-all uppercase tracking-wider ${loginTab === 'landlord' ? 'border-gray-400 text-white' : 'border-transparent text-gray-500 hover:text-gray-400'}`}
            >
              Landlord (Admin)
            </button>
            <button 
              type="button" 
              onClick={() => { setLoginTab('manager'); setEmail(''); setPassword(''); setLoginError(''); }}
              className={`flex-1 pb-3 text-xs font-bold border-b-2 transition-all uppercase tracking-wider ${loginTab === 'manager' ? 'border-gray-400 text-white' : 'border-transparent text-gray-500 hover:text-gray-400'}`}
            >
              Manager Portal
            </button>
          </div>

          {loginError && (
            <div className="bg-rose-500/10 border border-rose-500/20 text-rose-400 p-3 rounded-lg text-xs font-semibold mb-4 flex items-start gap-2 animate-pulse">
              <AlertCircle size={16} className="shrink-0 mt-0.5" />
              <p>{loginError}</p>
            </div>
          )}

          <form onSubmit={handleLoginSubmit} className="space-y-4">
            <div>
              <label className="block text-xs font-bold text-gray-400 uppercase tracking-wider mb-2">Account Email</label>
              <input 
                required type="email" value={email} onChange={e => setEmail(e.target.value)} 
                placeholder={loginTab === 'landlord' ? "Super Admin email address" : "Manager email address"} 
                className="w-full bg-slate-950 border border-gray-800 focus:border-gray-500 rounded-xl p-3 outline-none text-white text-sm transition-all"
              />
            </div>
            <div>
              <label className="block text-xs font-bold text-gray-400 uppercase tracking-wider mb-2">Secure Password</label>
              <div className="relative">
                <input 
                  required type={showPassword ? "text" : "password"} value={password} onChange={e => setPassword(e.target.value)} placeholder="••••••••"
                  className="w-full bg-slate-950 border border-gray-800 focus:border-gray-500 rounded-xl p-3 pr-10 outline-none text-white text-sm"
                />
                <button 
                  type="button" 
                  onClick={() => setShowPassword(!showPassword)}
                  className="absolute right-3 top-1/2 -translate-y-1/2 text-gray-400 hover:text-white transition-colors p-1"
                >
                  {showPassword ? <EyeOff size={18} /> : <Eye size={18} />}
                </button>
              </div>
              <div className="text-right mt-2">
                <button 
                  type="button" 
                  onClick={handleForgotPassword}
                  className="text-xs font-semibold text-gray-500 hover:text-gray-300 transition-colors"
                >
                  Forgot Password?
                </button>
              </div>
            </div>
            <button 
              type="submit" disabled={isProcessing}
              className="w-full bg-gray-800 hover:bg-gray-700 disabled:bg-gray-900 disabled:text-gray-600 disabled:cursor-not-allowed text-white font-bold py-3 rounded-xl transition-all hover:shadow-lg flex items-center justify-center gap-2 mt-2"
            >
              {isProcessing ? <div className="animate-spin rounded-full h-5 w-5 border-2 border-white border-t-transparent"></div> : 'Verify Credentials & Sign In'}
            </button>
          </form>

          {/* SECURE GOOGLE SINGLE-SIGN ON (SSO) ACCESS POINT */}
          <div className="mt-5 border-t border-gray-800 pt-5 text-center">
            <p className="text-gray-500 text-[10px] uppercase font-bold tracking-widest mb-3">Or connect instantly via SSO</p>
            <button 
              type="button"
              onClick={handleGoogleSignIn}
              disabled={isProcessing}
              className="w-full bg-slate-950 border border-gray-800 text-gray-300 hover:text-white hover:bg-slate-900 hover:border-gray-700 font-bold py-3 rounded-xl transition-all flex items-center justify-center gap-3 text-sm"
            >
              <svg className="w-4 h-4 shrink-0" viewBox="0 0 24 24" width="24" height="24" xmlns="http://www.w3.org/2000/svg">
                <g transform="matrix(1, 0, 0, 1, 0, 0)">
                  <path d="M21.35,11.1H12v2.7h5.38c-0.24,1.28 -0.96,2.37 -2.04,3.1v2.58h3.3c1.93,-1.78 3.04,-4.4 3.04,-7.48C21.68,11.78 21.56,11.4 21.35,11.1z" fill="#4285F4" />
                  <path d="M12,20.9c2.43,0 4.47,-0.8 5.96,-2.18l-3.3,-2.58c-0.92,0.62 -2.1,0.98 -3.6,0.98 -2.77,0 -5.11,-1.87 -5.95,-4.38H1.67v2.67C3.15,18.3 7.27,20.9 12,20.9z" fill="#34A853" />
                  <path d="M6.05,12.74a5.27,5.27,0,0,1,0,-3.48V6.59H1.67a8.91,8.91,0,0,0,0,8.82l4.38,-2.67z" fill="#FBBC05" />
                  <path d="M12,5.18c1.32,0 2.5,0.45 3.44,1.35l2.58,-2.58C16.46,2.51 14.43,1.7 12,1.7c-4.73,0 -8.85,2.6 -10.33,6.41l4.38,2.67C6.89,7.05 9.23,5.18 12,5.18z" fill="#EA4335" />
                </g>
              </svg>
              Sign In with Google
            </button>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className={`app-shell min-h-screen flex flex-col md:flex-row font-sans transition-colors duration-200 ${theme === 'dark' ? 'dark bg-black text-slate-100' : 'light bg-[#F7F7F5] text-gray-900'}`}>
      
      {/* MOBILE HEADER */}
      <div className={`md:hidden flex items-center justify-between p-4 z-40 relative shadow-sm ${theme === 'dark' ? 'bg-slate-900 border-b border-slate-800' : 'bg-[#F4EFE6] border-b border-[#E8DFCE]'}`}>
        <div className="flex items-center gap-3">
          <img src="/HSlogo.png" alt="Logo" className={`w-8 h-8 rounded-full object-cover border ${theme === 'dark' ? 'border-slate-700' : 'border-gray-300'}`} />
          <h1 className="font-bold text-lg">Ruiru Rentals</h1>
        </div>
        <button onClick={() => setSidebarOpen(!sidebarOpen)} className={`p-2 rounded-lg transition ${theme === 'dark' ? 'hover:bg-white/5' : 'hover:bg-black/5'}`}>
          <Menu size={24} />
        </button>
      </div>

      {/* MOBILE OVERLAY */}
      {sidebarOpen && (
        <div className="md:hidden fixed inset-0 bg-black/40 backdrop-blur-sm z-40 transition-opacity" onClick={() => setSidebarOpen(false)}></div>
      )}

      {/* SIDEBAR */}
      <aside className={`fixed inset-y-0 left-0 transform ${sidebarOpen ? 'translate-x-0' : '-translate-x-full'} md:relative md:translate-x-0 z-50 w-64 flex flex-col shrink-0 transition-transform duration-300 ease-in-out shadow-2xl md:shadow-none ${theme === 'dark' ? 'bg-slate-900 text-slate-300 border-r border-slate-800' : 'bg-[#F4EFE6] text-gray-800 border-r border-[#E8DFCE]'}`}>
        <div className={`p-6 border-b flex items-center justify-between ${theme === 'dark' ? 'border-slate-800' : 'border-black/5'}`}>
          <div className="flex items-center gap-3">
            <img src="/HSlogo.png" alt="Logo" className={`w-10 h-10 rounded-xl object-cover shadow-sm border ${theme === 'dark' ? 'border-slate-700' : 'border-gray-300'}`} />
            <div>
              <h1 className={`text-lg font-extrabold leading-tight ${theme === 'dark' ? 'text-white' : 'text-gray-900'}`}>Ruiru Rentals</h1>
              <p className="text-[10px] font-bold text-gray-500 uppercase tracking-wider">{role === 'LANDLORD' ? 'Super Admin' : 'Manager'}</p>
            </div>
          </div>
          <div className="flex flex-col gap-2 items-end">
            <button type="button" onClick={() => setTheme(theme === 'light' ? 'dark' : 'light')} className={`p-2 rounded-lg transition ${theme === 'light' ? 'bg-[#E8DFCE] text-gray-700 hover:bg-[#DCD4C6]' : 'bg-slate-800 text-amber-400 hover:text-white hover:bg-slate-700'}`}>
              {theme === 'light' ? <Moon size={16} /> : <Sun size={16} />}
            </button>
            <button className="md:hidden p-1 opacity-50 hover:opacity-100" onClick={() => setSidebarOpen(false)}><X size={20}/></button>
          </div>
        </div>
        
        <nav className="flex-1 p-4 space-y-1 overflow-y-auto" aria-label="Main navigation">
          {navItems.filter(item => can(item.permission)).map(item => {
            const Icon = item.icon;
            return (
              <button key={item.id} onClick={() => { setActiveTab(item.id); setSidebarOpen(false); }} className={`w-full flex items-center justify-between gap-3 px-3 py-2.5 rounded-lg text-sm font-semibold transition-all ${activeTab === item.id ? 'bg-gray-800 text-white shadow-sm' : theme === 'dark' ? 'hover:bg-slate-800 text-slate-400' : 'hover:bg-[#E8DFCE] text-gray-600'}`} aria-current={activeTab === item.id ? 'page' : undefined}>
                <span className="flex items-center gap-3"><Icon size={17} aria-hidden="true" /> {item.label}</span>
                {item.badge > 0 && <span className="bg-amber-600 text-white text-[10px] px-1.5 py-0.5 rounded-full font-bold">{item.badge}</span>}
              </button>
            );
          })}
        </nav>
        <div className={`p-4 border-t ${theme === 'dark' ? 'border-slate-800' : 'border-black/5'}`}>
          <button onClick={handleLogout} className="w-full flex items-center gap-2 text-sm font-bold text-gray-500 hover:text-rose-500 hover:bg-rose-500/10 p-3 rounded-xl transition-all">
            <LogOut size={18} /> Secure Sign Out
          </button>
        </div>
      </aside>

      {/* MAIN CONTENT AREA */}
      <div className="flex-1 flex flex-col h-screen overflow-hidden">
        <main className="flex-1 p-6 md:p-8 overflow-y-auto w-full transition-all duration-300 ease-in-out flex flex-col">
          <header className={`flex flex-col lg:flex-row lg:items-center justify-between gap-4 pb-6 mb-6 border-b ${theme === 'dark' ? 'border-[#262626]' : 'border-[#E5E5E5]'}`}>
            <div>
              <p className="text-[11px] uppercase tracking-[0.18em] text-gray-500 font-semibold">{role === ROLES.LANDLORD ? 'Landlord workspace' : 'Operations workspace'}</p>
              <h2 className={`text-2xl font-semibold mt-1 ${theme === 'dark' ? 'text-white' : 'text-gray-900'}`}>{navItems.find(item => item.id === activeTab)?.label || 'Dashboard'}</h2>
            </div>
            <div className="flex items-center gap-2 w-full lg:w-auto">
              <label className={`relative flex-1 lg:w-80 ${theme === 'dark' ? 'text-slate-400' : 'text-gray-500'}`}>
                <Search size={16} className="absolute left-3 top-1/2 -translate-y-1/2" aria-hidden="true" />
                <span className="sr-only">Search tenants, units, payments, or maintenance</span>
                <input value={globalSearch} onChange={e => setGlobalSearch(e.target.value)} placeholder="Search records" className={`w-full pl-9 pr-3 py-2.5 rounded-lg border text-sm outline-none focus:ring-2 focus:ring-amber-600/40 ${theme === 'dark' ? 'bg-[#0A0A0A] border-[#303030] text-white placeholder:text-[#737373]' : 'bg-white border-[#E5E5E5] text-gray-900 placeholder:text-gray-400'}`} />
              </label>
              <button onClick={() => setActiveTab('activity')} className={`relative p-2.5 rounded-lg border transition ${theme === 'dark' ? 'border-[#303030] text-slate-300 hover:bg-[#171717]' : 'border-[#E5E5E5] text-gray-600 hover:bg-white'}`} aria-label="Open activity history">
                <Bell size={17} aria-hidden="true" />
                {notifications.filter(notification => !notification.read).length > 0 && <span className="absolute -top-1 -right-1 min-w-4 h-4 px-1 rounded-full bg-amber-600 text-white text-[9px] flex items-center justify-center">{notifications.filter(notification => !notification.read).length}</span>}
              </button>
            </div>
          </header>

          {dataError && <div className={`mb-6 flex items-start gap-3 p-3 rounded-lg border text-sm ${theme === 'dark' ? 'border-amber-700/50 bg-amber-950/30 text-amber-300' : 'border-amber-200 bg-amber-50 text-amber-800'}`} role="status"><ShieldAlert size={18} className="mt-0.5 shrink-0" /><span>{dataError}</span></div>}
          
          <div className="flex-1">
            {activeTab === 'dashboard' && role === 'LANDLORD' && (
              <div className="space-y-6 animate-in fade-in duration-500">
                <div className="flex justify-between items-center">
                  <h2 className={`text-2xl font-bold ${theme === 'dark' ? 'text-white' : 'text-gray-900'}`}>Landlord Finance Overview</h2>
                </div>
                
                {stats.waterReserve < 0 ? (
                  <div className="bg-rose-500/10 border border-rose-500/30 p-4 rounded-xl flex items-center gap-4 animate-pulse">
                    <div className="bg-rose-500/20 p-3 rounded-full text-rose-500"><AlertCircle size={24}/></div>
                    <div className="flex-1">
                      <h4 className="text-rose-500 font-bold">Deficit Alert: RUJWASCO Bill Settle Needed</h4>
                      <p className={`text-sm ${theme === 'dark' ? 'text-rose-400' : 'text-rose-700'}`}>
                        Collected water payments from tenants total <strong className="font-mono">{formatKes(stats.collectedWaterRev)}</strong>. 
                        This is short by <strong className={`font-mono text-lg ${theme === 'dark' ? 'text-rose-500' : 'text-rose-600'}`}>{formatKes(Math.abs(stats.waterReserve))}</strong> to settle the logged invoices of <strong className="font-mono">{formatKes(stats.totalMasterWaterBills)}</strong>.
                      </p>
                    </div>
                  </div>
                ) : stats.totalMasterWaterBills > 0 ? (
                  <div className="bg-emerald-500/10 border border-emerald-500/30 p-4 rounded-xl flex items-center gap-4">
                    <div className={`bg-emerald-500/20 p-3 rounded-full ${theme === 'dark' ? 'text-emerald-500' : 'text-emerald-600'}`}><BellRing size={24}/></div>
                    <div className="flex-1">
                      <h4 className={`font-bold ${theme === 'dark' ? 'text-emerald-400' : 'text-emerald-700'}`}>Water Settle Target Met!</h4>
                      <p className={`text-sm ${theme === 'dark' ? 'text-emerald-500' : 'text-emerald-800'}`}>
                        The needed water bills of <strong className="font-mono">{formatKes(stats.totalMasterWaterBills)}</strong> are fully accumulated inside the vault! 
                        Current accumulated water funds: <strong className="font-mono">{formatKes(stats.collectedWaterRev)}</strong>. (Remaining Surplus: <strong className="font-mono">{formatKes(stats.waterReserve)}</strong>).
                      </p>
                    </div>
                  </div>
                ) : (
                  <div className="bg-cyan-500/10 border border-cyan-500/30 p-4 rounded-xl flex items-center gap-4">
                    <div className={`bg-cyan-500/20 p-3 rounded-full ${theme === 'dark' ? 'text-cyan-500' : 'text-cyan-600'}`}><Info size={24}/></div>
                    <div className="flex-1">
                      <h4 className={`font-bold ${theme === 'dark' ? 'text-cyan-400' : 'text-cyan-700'}`}>Water Vault Tracker</h4>
                      <p className={`text-sm ${theme === 'dark' ? 'text-cyan-500' : 'text-cyan-800'}`}>
                        Accumulated water payments inside vault: <strong className="font-mono">{formatKes(stats.collectedWaterRev)}</strong>. Log a master provider bill to evaluate balance limits.
                      </p>
                    </div>
                  </div>
                )}

                <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
                  <div className={`p-6 rounded-2xl border shadow-sm transition-all duration-300 hover:-translate-y-1 hover:shadow-lg ${theme === 'dark' ? 'bg-emerald-950/20 border-emerald-800' : 'bg-emerald-50/50 border-emerald-200'}`}>
                    <p className={`text-sm font-bold mb-1 ${theme === 'dark' ? 'text-emerald-500' : 'text-emerald-700'}`}>Total Rent Collected</p>
                    <h3 className={`text-2xl font-extrabold ${theme === 'dark' ? 'text-emerald-400' : 'text-emerald-600'}`}>{formatKes(stats.collectedRentRev)}</h3>
                    <p className={`text-[10px] mt-1 font-bold ${theme === 'dark' ? 'text-emerald-500' : 'text-emerald-700'}`}>All-Time Expected: {formatKes(stats.expectedRentRev)}</p>
                  </div>

                  <div className={`p-6 rounded-2xl border shadow-sm flex flex-col justify-between transition-all duration-300 hover:-translate-y-1 hover:shadow-lg ${theme === 'dark' ? 'bg-cyan-950/20 border-cyan-800' : 'bg-cyan-50/50 border-cyan-200'}`}>
                    <div>
                      <p className={`text-xs font-extrabold uppercase tracking-wide mb-1 flex items-center gap-1 ${theme === 'dark' ? 'text-cyan-400' : 'text-cyan-600'}`}>
                        <Droplet size={14}/> Water Vault Total
                      </p>
                      <h3 className={`text-2xl font-extrabold ${theme === 'dark' ? 'text-cyan-300' : 'text-cyan-500'}`}>{formatKes(stats.collectedWaterRev)}</h3>
                    </div>
                    <div className={`mt-3 pt-3 border-t ${theme === 'dark' ? 'border-cyan-900/40' : 'border-cyan-200'}`}>
                      <button onClick={() => { setModalError(''); setIsWaterBillModalOpen(true); }} className={`w-full text-white text-[10px] font-bold py-2 rounded-lg transition ${theme === 'dark' ? 'bg-cyan-600 hover:bg-cyan-700' : 'bg-cyan-700 hover:bg-cyan-800'}`}>
                        Log RUJWASCO Invoice
                      </button>
                    </div>
                  </div>

                  <div className={`p-6 rounded-2xl border shadow-sm flex flex-col justify-between transition-all duration-300 hover:-translate-y-1 hover:shadow-lg ${theme === 'dark' ? 'bg-rose-950/20 border-rose-800' : 'bg-rose-50/50 border-rose-200'}`}>
                    <div>
                      <p className={`text-xs font-extrabold uppercase tracking-wide mb-1 flex items-center gap-1 ${theme === 'dark' ? 'text-rose-400' : 'text-rose-600'}`}>
                        <AlertCircle size={14}/> Total Operations Exp.
                      </p>
                      <h3 className={`text-2xl font-extrabold ${theme === 'dark' ? 'text-rose-400' : 'text-rose-600'}`}>{formatKes(stats.totalOperatingExpenses)}</h3>
                    </div>
                    <div className={`mt-3 pt-3 border-t text-[10px] font-bold space-y-0.5 ${theme === 'dark' ? 'border-rose-900/40 text-rose-400' : 'border-rose-200 text-rose-600'}`}>
                      <p>Repairs: {formatKes(stats.totalRepairExpenses)}</p>
                      <p>Septic Removals: {formatKes(stats.totalSepticExpenses)}</p>
                    </div>
                  </div>

                  <div className={`p-6 rounded-2xl border shadow-sm transition-all duration-300 hover:-translate-y-1 hover:shadow-lg ${theme === 'dark' ? 'bg-gray-900/50 border-gray-800' : 'bg-[#E8DFCE]/50 border-[#DCD4C6]'}`}>
                    <p className={`text-xs font-extrabold uppercase tracking-wide mb-1 flex items-center gap-1 ${theme === 'dark' ? 'text-gray-400' : 'text-gray-600'}`}>
                      <Coins size={14}/> Joseph's Tip Pool
                    </p>
                    <h3 className={`text-2xl font-black font-mono ${theme === 'dark' ? 'text-gray-200' : 'text-gray-900'}`}>{formatKes(stats.totalJosephBonus)}</h3>
                    <p className="text-[10px] text-gray-500 font-bold mt-1">Accumulated from excess payments</p>
                  </div>
                </div>

                <div className={`rounded-2xl border p-6 shadow-sm ${theme === 'dark' ? 'bg-slate-900 border-slate-800' : 'bg-[#F4EFE6] border-[#E8DFCE]'}`}>
                  <h3 className={`text-lg font-bold mb-4 ${theme === 'dark' ? 'text-white' : 'text-gray-900'}`}>Pending Verifications</h3>
                  <p className="text-sm text-gray-500 mb-4 font-medium">Logged by Manager; needs Super Admin confirmation.</p>
                  {payments.filter(p => p.status === 'PENDING').length === 0 ? (
                    <p className={`text-sm font-bold p-4 rounded-xl flex items-center gap-2 ${theme === 'dark' ? 'bg-emerald-500/10 text-emerald-400' : 'bg-emerald-500/10 text-emerald-600'}`}>
                      <CheckCircle2 size={18}/> All payments verified and up to date.
                    </p>
                  ) : (
                    <div className="space-y-3">
                      {payments.filter(p => p.status === 'PENDING').map(p => (
                        <div key={p.id} className={`flex flex-col sm:flex-row sm:items-center justify-between p-4 rounded-xl border gap-4 transition-all hover:shadow-md ${theme === 'dark' ? 'bg-slate-950 border-slate-800' : 'bg-[#FDFBF7] border-[#E8DFCE]'}`}>
                          <div>
                            <p className={`font-bold text-lg ${theme === 'dark' ? 'text-white' : 'text-gray-900'}`}>{p.tenantName}</p>
                            <p className="text-xs text-gray-500 font-semibold">{p.type === 'COMBINED' ? 'Rent & Water Combined' : p.type} via {p.method}</p>
                            {p.messageCode && (
                              <p className={`text-[10px] font-mono font-bold mt-1.5 inline-block px-2 py-1 rounded-md border ${theme === 'dark' ? 'bg-white/10 text-gray-300 border-white/10' : 'bg-black/5 text-gray-700 border-black/10'}`}>Ref: {p.messageCode}</p>
                            )}
                          </div>
                          <div className="flex items-center justify-between sm:justify-end gap-4">
                            <span className={`font-black text-xl ${theme === 'dark' ? 'text-white' : 'text-gray-900'}`}>{formatKes(p.amount)}</span>
                            <button 
                              onClick={() => handleConfirmPayment(p)} 
                              disabled={isProcessing}
                              className="bg-gray-800 hover:bg-gray-900 text-white px-5 py-2.5 rounded-xl text-sm font-bold transition-all disabled:bg-gray-400 flex items-center gap-2"
                            >
                              {isProcessing ? 'Processing...' : 'Confirm'}
                            </button>
                          </div>
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              </div>
            )}

            {activeTab === 'dashboard' && role === ROLES.MANAGER && (
              <div className="space-y-6">
                <div className={`p-5 border rounded-lg ${theme === 'dark' ? 'bg-[#0A0A0A] border-[#262626]' : 'bg-white border-[#E5E5E5]'}`}>
                  <p className="text-xs uppercase tracking-wider text-gray-500 font-semibold">Today’s operating brief</p>
                  <h3 className={`text-xl font-semibold mt-1 ${theme === 'dark' ? 'text-white' : 'text-gray-900'}`}>Keep collections and maintenance moving.</h3>
                  <div className="flex flex-wrap gap-2 mt-4">
                    <button onClick={() => setActiveTab('billing')} className="bg-gray-800 text-white px-3 py-2 rounded-lg text-sm font-semibold flex items-center gap-2"><Wallet size={15}/> Record payment</button>
                    <button onClick={() => { setActiveTab('repairs'); setIsRepairModalOpen(true); }} className={`px-3 py-2 rounded-lg text-sm font-semibold border flex items-center gap-2 ${theme === 'dark' ? 'border-[#303030] text-white hover:bg-[#171717]' : 'border-[#E5E5E5] text-gray-800 hover:bg-gray-50'}`}><Wrench size={15}/> Report maintenance</button>
                    <button onClick={() => setActiveTab('tenants')} className={`px-3 py-2 rounded-lg text-sm font-semibold border flex items-center gap-2 ${theme === 'dark' ? 'border-[#303030] text-white hover:bg-[#171717]' : 'border-[#E5E5E5] text-gray-800 hover:bg-gray-50'}`}><Users size={15}/> View tenants</button>
                  </div>
                </div>
                <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
                  {[
                    ['Units', stats.totalUnits, Building2],
                    ['Occupied', stats.occupiedUnits, Home],
                    ['Occupancy', `${stats.occupancyRate}%`, ArrowUpRight],
                    ['Open maintenance', stats.openRepairs, Wrench],
                  ].map(([label, value, Icon]) => <div key={label} className={`p-4 border rounded-lg ${theme === 'dark' ? 'bg-[#0A0A0A] border-[#262626]' : 'bg-white border-[#E5E5E5]'}`}><Icon size={16} className="text-amber-600 mb-3"/><p className="text-xs text-gray-500">{label}</p><p className={`text-2xl font-semibold mt-1 ${theme === 'dark' ? 'text-white' : 'text-gray-900'}`}>{value}</p></div>)}
                </div>
                <div className={`border rounded-lg overflow-hidden ${theme === 'dark' ? 'bg-[#0A0A0A] border-[#262626]' : 'bg-white border-[#E5E5E5]'}`}>
                  <div className="p-4 border-b border-inherit flex items-center justify-between"><h3 className="font-semibold">Recent activity</h3><button onClick={() => setActiveTab('activity')} className="text-xs text-amber-700 dark:text-amber-400 font-semibold">View all</button></div>
                  <div className="divide-y divide-inherit">{activityLogs.slice(0, 5).length === 0 ? <p className="p-5 text-sm text-gray-500">No activity has been recorded yet.</p> : activityLogs.slice(0, 5).map(log => <div key={log.id} className="p-4 flex items-center justify-between gap-4 text-sm"><span className="font-medium">{String(log.action || 'Activity').replaceAll('_', ' ')}</span><time className="text-xs text-gray-500">{log.timestamp ? new Date(log.timestamp).toLocaleString('en-KE', { timeZone: DEFAULT_TIMEZONE }) : '—'}</time></div>)}</div>
                </div>
              </div>
            )}

            {activeTab === 'houses' && (
              <div className="space-y-6 animate-in fade-in duration-500">
                <div className="flex justify-between items-center">
                  <h2 className={`text-2xl font-bold ${theme === 'dark' ? 'text-white' : 'text-gray-900'}`}>Properties & Units</h2>
                  {role === 'LANDLORD' && (
                    <button onClick={() => { setModalError(''); setIsHouseModalOpen(true); }} className="bg-gray-800 hover:bg-gray-900 text-white px-5 py-2.5 rounded-xl text-sm font-bold flex items-center gap-2 shadow-sm transition-all hover:shadow-md hover:-translate-y-0.5">
                      <Plus size={18}/> Add Unit
                    </button>
                  )}
                </div>

                <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-5">
                  {houses.length === 0 && <p className="text-gray-500 font-medium">No houses registered yet.</p>}
                  {filteredHouses.map(house => {
                    const isVacant = house.status === 'VACANT' && !occupiedHouseIds.has(house.id);
                    const isUnderRepair = house.status === 'UNDER_REPAIR';
                    const isOccupied = house.status === 'OCCUPIED' || occupiedHouseIds.has(house.id);
                    
                    return (
                      <div key={house.id} className={`p-5 rounded-2xl border shadow-sm relative overflow-hidden transition-all duration-300 hover:-translate-y-1 hover:shadow-xl flex flex-col justify-between ${theme === 'dark' ? 'bg-slate-900 border-slate-800' : 'bg-[#F4EFE6] border-[#E8DFCE]'}`}>
                        <div className={`absolute top-0 left-0 w-2 h-full ${isUnderRepair ? 'bg-rose-500' : isVacant ? 'bg-amber-500' : 'bg-emerald-500'}`}></div>
                        <div>
                          <div className="flex justify-between items-start mb-3 ml-2">
                            <h3 className={`font-bold text-xl ${theme === 'dark' ? 'text-white' : 'text-gray-900'}`}>{house.name}</h3>
                            <span className={`text-[10px] px-2.5 py-1 rounded-md font-black uppercase tracking-wider border ${isUnderRepair ? 'bg-rose-100 text-rose-700 border-rose-200' : isVacant ? 'bg-amber-100 text-amber-700 border-amber-200' : 'bg-emerald-100 text-emerald-700 border-emerald-200'}`}>
                              {isUnderRepair ? 'Under Repair' : isVacant ? 'VACANT' : 'OCCUPIED'}
                            </span>
                          </div>
                          <div className={`ml-2 text-sm space-y-1.5 font-medium ${theme === 'dark' ? 'text-slate-400' : 'text-gray-500'}`}>
                            <p>Type: {house.type}</p>
                            <p>Rent Target: <strong className={`font-black text-base ${theme === 'dark' ? 'text-white' : 'text-gray-900'}`}>{formatKes(house.rent)}</strong></p>
                            
                            {house.repairStatus === 'NEEDS_REPAIR' && isOccupied && (
                              <div className="bg-rose-500/10 border border-rose-500/20 px-3 py-2 rounded-lg mt-3">
                                <p className={`text-xs font-bold flex items-center gap-1.5 animate-pulse ${theme === 'dark' ? 'text-rose-400' : 'text-rose-600'}`}>
                                  <AlertCircle size={14}/> Needs Action (Complaint Logged)
                                </p>
                              </div>
                            )}
                          </div>
                        </div>
                        
                        {role === 'LANDLORD' && !isOccupied && (
                          <div className={`ml-2 mt-4 pt-4 border-t ${theme === 'dark' ? 'border-white/10' : 'border-black/5'}`}>
                            <button 
                              onClick={() => handleToggleHouseRepairMode(house)}
                              disabled={isProcessing}
                              className={`w-full text-xs font-bold py-2.5 rounded-xl transition-all disabled:opacity-50 flex items-center justify-center gap-2 ${isUnderRepair ? 'bg-emerald-600 hover:bg-emerald-700 text-white' : 'bg-gray-800 hover:bg-gray-900 text-white'}`}>
                              {isUnderRepair ? <><CheckCircle2 size={16}/> Mark as Ready & Vacant</> : <><Wrench size={16}/> Set to Under Repair</>}
                            </button>
                          </div>
                        )}
                      </div>
                    )
                  })}
                </div>
              </div>
            )}

            {activeTab === 'tenants' && (
              <div className="space-y-6 animate-in fade-in duration-500">
                <div className="flex justify-between items-center">
                  <div>
                    <h2 className={`text-2xl font-bold ${theme === 'dark' ? 'text-white' : 'text-gray-900'}`}>Tenants Directory</h2>
                  </div>
                  <button onClick={() => { setModalError(''); setIsTenantModalOpen(true); }} className="bg-gray-800 hover:bg-gray-900 text-white px-5 py-2.5 rounded-xl text-sm font-bold flex items-center gap-2 shadow-sm transition-all hover:shadow-md hover:-translate-y-0.5">
                    <Plus size={18}/> Register Tenant
                  </button>
                </div>

                <div className={`rounded-2xl border overflow-hidden shadow-sm ${theme === 'dark' ? 'bg-slate-900 border-slate-800' : 'bg-[#F4EFE6] border-[#E8DFCE]'}`}>
                  <table className="w-full text-left text-sm">
                    <thead className={`border-b ${theme === 'dark' ? 'bg-slate-950 border-slate-800 text-slate-400' : 'bg-[#FDFBF7] border-[#E8DFCE] text-gray-500'}`}>
                      <tr>
                        <th className="p-4 font-bold">Tenant Name</th>
                        <th className="p-4 font-bold hidden sm:table-cell">House Unit</th>
                        <th className="p-4 font-bold hidden sm:table-cell">Bal Status</th>
                        <th className="p-4 font-bold text-right">Actions</th>
                      </tr>
                    </thead>
                    <tbody className={`divide-y ${theme === 'dark' ? 'divide-slate-800' : 'divide-[#E8DFCE]'}`}>
                      {tenants.length === 0 && (
                        <tr><td colSpan="4" className="p-8 text-center text-gray-500 font-medium">No tenants registered.</td></tr>
                      )}
                      {filteredTenants.map(tenant => {
                        const house = houses.find(h => h.id === tenant.houseId);
                        const owesMoney = (tenant.expectedRent - tenant.paidRent) > 0 || (tenant.expectedWater - tenant.paidWater) > 0;
                        return (
                          <tr key={tenant.id} className={`transition cursor-pointer ${theme === 'dark' ? 'hover:bg-slate-950/40' : 'hover:bg-[#FDFBF7]'}`} onClick={() => setSelectedTenantForDetails(tenant)}>
                            <td className={`p-4 font-bold ${theme === 'dark' ? 'text-white' : 'text-gray-900'}`}>{tenant.name}</td>
                            <td className={`p-4 font-semibold hidden sm:table-cell ${theme === 'dark' ? 'text-slate-300' : 'text-gray-600'}`}>{house ? house.name : 'Unknown'}</td>
                            <td className="p-4 hidden sm:table-cell">
                              {owesMoney ? <span className={`font-bold text-[10px] uppercase tracking-wider px-2.5 py-1 rounded-md border ${theme === 'dark' ? 'bg-rose-500/10 text-rose-400 border-rose-500/20' : 'bg-rose-500/10 text-rose-600 border-rose-500/20'}`}>Has Arrears</span> : <span className={`font-bold text-[10px] uppercase tracking-wider px-2.5 py-1 rounded-md border ${theme === 'dark' ? 'bg-emerald-500/10 text-emerald-400 border-emerald-500/20' : 'bg-emerald-500/10 text-emerald-600 border-emerald-500/20'}`}>Cleared</span>}
                            </td>
                            <td className="p-4 text-right">
                              <button onClick={(e) => { e.stopPropagation(); setSelectedTenantForDetails(tenant); }} className={`text-xs font-bold px-4 py-2 rounded-lg border transition-colors ${theme === 'dark' ? 'text-gray-300 hover:text-white bg-white/5 border-white/10' : 'text-gray-700 hover:text-gray-900 bg-black/5 border-black/10'}`}>View Profile</button>
                            </td>
                          </tr>
                        )
                      })}
                    </tbody>
                  </table>
                </div>
              </div>
            )}

            {activeTab === 'billing' && (
              <div className="space-y-8 animate-in fade-in duration-500">
                <h2 className={`text-2xl font-bold ${theme === 'dark' ? 'text-white' : 'text-gray-900'}`}>Billing & Payments</h2>

                <div>
                  <h3 className="text-lg font-bold mb-4 font-mono uppercase tracking-wider text-gray-500">Tenant Billing Profiles</h3>
                  <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
                    {filteredTenants.map(tenant => {
                      const house = houses.find(h => h.id === tenant.houseId);
                      const rentBal = (tenant.expectedRent || 0) - (tenant.paidRent || 0);
                      const waterBal = (tenant.expectedWater || 0) - (tenant.paidWater || 0);
                      const tenantRepairs = repairs.filter(r => r.houseId === tenant.houseId && r.status === 'OPEN');
                      const pendingPayments = payments.filter(p => p.tenantId === tenant.id && p.status === 'PENDING');

                      return (
                        <div key={tenant.id} className={`p-5 rounded-2xl border shadow-sm flex flex-col justify-between transition-all duration-300 hover:-translate-y-1 hover:shadow-xl ${theme === 'dark' ? 'bg-slate-900 border-slate-800' : 'bg-[#F4EFE6] border-[#E8DFCE]'}`}>
                          <div>
                            <div className={`flex justify-between items-start mb-3 border-b pb-3 gap-2 ${theme === 'dark' ? 'border-slate-800' : 'border-[#DCD4C6]'}`}>
                              <div>
                                <h4 className={`font-extrabold text-lg leading-tight ${theme === 'dark' ? 'text-white' : 'text-gray-900'}`}>{tenant.name}</h4>
                                <div className={`flex items-center gap-1.5 text-xs font-bold mt-1.5 ${theme === 'dark' ? 'text-slate-400' : 'text-gray-600'}`}>
                                  <Home size={14} className={`shrink-0 ${theme === 'dark' ? 'text-gray-400' : 'text-gray-800'}`}/> {house ? house.name : 'Unassigned'}
                                </div>
                                <div className={`flex items-center gap-1.5 text-xs font-bold mt-1 ${theme === 'dark' ? 'text-slate-400' : 'text-gray-600'}`}>
                                  <Phone size={14} className={`shrink-0 ${theme === 'dark' ? 'text-emerald-500' : 'text-emerald-600'}`}/> {tenant.phone}
                                </div>
                              </div>
                              <div className={`text-right shrink-0 whitespace-nowrap p-2 rounded-xl border ${theme === 'dark' ? 'bg-white/5 border-white/5' : 'bg-black/5 border-black/5'}`}>
                                <span className="text-[9px] text-gray-500 font-black uppercase block tracking-widest">Rent Bal</span>
                                <span className={`text-sm font-black block ${rentBal > 0 ? (theme === 'dark' ? 'text-rose-500' : 'text-rose-600') : (theme === 'dark' ? 'text-emerald-500' : 'text-emerald-600')}`}>{formatKes(rentBal)}</span>
                                <span className="text-[9px] text-gray-500 font-black uppercase block tracking-widest mt-1.5">Water Bal</span>
                                <span className={`text-sm font-black block ${waterBal > 0 ? (theme === 'dark' ? 'text-rose-500' : 'text-rose-600') : (theme === 'dark' ? 'text-emerald-500' : 'text-emerald-600')}`}>{formatKes(waterBal)}</span>
                              </div>
                            </div>

                            {tenantRepairs.length > 0 && (
                              <div className={`mb-4 border p-3 rounded-xl flex items-start gap-2 text-xs ${theme === 'dark' ? 'bg-rose-500/10 border-rose-500/20 text-rose-400' : 'bg-rose-500/10 border-rose-500/20 text-rose-600'}`}>
                                <AlertCircle size={16} className="shrink-0 mt-0.5"/>
                                <div>
                                  <span className="font-bold block mb-1">Active Complaints:</span>
                                  {tenantRepairs.slice(0, 2).map(r => <span key={r.id} className="block truncate max-w-200px font-semibold">- {r.description}</span>)}
                                </div>
                              </div>
                            )}

                            {pendingPayments.map(pendingPayment => (
                              <div key={pendingPayment.id} className="mb-4 bg-amber-500/10 border border-amber-500/20 p-3.5 rounded-xl shadow-sm">
                                <h5 className={`text-xs font-black flex items-center gap-1.5 mb-1.5 uppercase tracking-wider ${theme === 'dark' ? 'text-amber-500' : 'text-amber-600'}`}><Clock size={14}/> Pending Approval</h5>
                                <div className={`text-[11px] space-y-1 font-semibold flex justify-between ${theme === 'dark' ? 'text-slate-400' : 'text-gray-600'}`}>
                                  <div>
                                    <p>Amount: <span className={`font-black text-xs ${theme === 'dark' ? 'text-white' : 'text-gray-900'}`}>{formatKes(pendingPayment.amount)}</span></p>
                                    <p>Type: {pendingPayment.type === 'COMBINED' ? 'Rent & Water' : pendingPayment.type}</p>
                                  </div>
                                  <div className="text-right">
                                    <p>Code: <span className={`font-mono bg-amber-500/20 px-1.5 rounded font-bold uppercase border border-amber-500/20 ${theme === 'dark' ? 'text-amber-400' : 'text-amber-700'}`}>{pendingPayment.messageCode || "NONE"}</span></p>
                                    <p className="text-[10px] mt-0.5">{pendingPayment.method}</p>
                                  </div>
                                </div>
                                {role === 'LANDLORD' && (
                                  <button 
                                    onClick={() => handleConfirmPayment(pendingPayment)} 
                                    disabled={isProcessing}
                                    className="w-full mt-3 bg-amber-600 hover:bg-amber-700 text-white font-bold text-xs py-2 rounded-lg transition-all disabled:opacity-50 shadow-sm"
                                  >
                                    {isProcessing ? 'Processing...' : 'Confirm & Update Balances'}
                                  </button>
                                )}
                              </div>
                            ))}
                          </div>

                          <div className={`flex flex-col gap-2.5 mt-4 pt-3 border-t ${theme === 'dark' ? 'border-slate-800' : 'border-[#DCD4C6]'}`}>
                            <div className="flex gap-2.5">
                              <button onClick={() => { setModalError(''); setSelectedTenant(tenant); setIsPaymentModalOpen(true); }} className="flex-1 bg-gray-800 hover:bg-gray-900 text-white text-xs font-bold py-2.5 rounded-xl transition-all shadow-sm text-center">Log Payment</button>
                              {role === 'MANAGER' && (
                                <button onClick={() => { setModalError(''); setSelectedTenant(tenant); setIsBillingModalOpen(true); }} className={`flex-1 text-xs font-bold py-2.5 rounded-xl transition-all shadow-sm text-center border ${theme === 'dark' ? 'bg-slate-800 hover:bg-slate-700 text-slate-200 border-slate-700' : 'bg-white hover:bg-gray-50 text-gray-800 border-gray-200'}`}>Update Bills</button>
                              )}
                            </div>
                            {role === 'LANDLORD' && (
                              <button onClick={() => { setSelectedTenant(tenant); setIsHistoryModalOpen(true); }} className={`w-full text-xs font-bold py-2.5 rounded-xl transition flex items-center justify-center gap-1.5 border ${theme === 'dark' ? 'bg-slate-800 hover:bg-slate-700 text-slate-200 border-slate-700' : 'bg-[#FDFBF7] hover:bg-white text-gray-700 border-[#DCD4C6]'}`}>
                                <ListOrdered size={16}/> View Verified History
                              </button>
                            )}
                          </div>
                        </div>
                      )
                    })}
                  </div>
                </div>

                <div>
                  <div className="flex justify-between items-end mb-4">
                    <h3 className="text-lg font-bold font-mono uppercase tracking-wider text-gray-500">Payment Ledger</h3>
                    <button onClick={printLedgerReport} className="text-xs font-bold px-4 py-2 bg-gray-800 hover:bg-gray-900 text-white rounded-lg flex items-center gap-2 transition-all shadow-sm">
                      <Download size={14} /> Download Ledger Report
                    </button>
                  </div>
                  
                  <div className={`rounded-2xl border overflow-hidden shadow-sm overflow-x-auto ${theme === 'dark' ? 'bg-slate-900 border-slate-800' : 'bg-[#F4EFE6] border-[#E8DFCE]'}`}>
                    <table className="w-full text-left text-sm min-w-150 whitespace-nowrap">
                      <thead className={`border-b ${theme === 'dark' ? 'bg-slate-950 border-slate-800 text-slate-400' : 'bg-[#FDFBF7] border-[#E8DFCE] text-gray-500'}`}>
                        <tr>
                          <th className="p-4 font-bold">Date</th>
                          <th className="p-4 font-bold">Tenant</th>
                          <th className="p-4 font-bold">Transaction Ref</th>
                          <th className="p-4 font-bold">Type</th>
                          <th className="p-4 font-bold">Amount Received</th>
                          <th className="p-4 font-bold">Excess Split</th>
                          <th className="p-4 font-bold">Status</th>
                        </tr>
                      </thead>
                      <tbody className={`divide-y ${theme === 'dark' ? 'divide-slate-800' : 'divide-[#E8DFCE]'}`}>
                        {payments.length === 0 && (
                          <tr><td colSpan="7" className="p-8 text-center text-gray-500 font-medium">No payments recorded.</td></tr>
                        )}
                        {filteredPayments.map(payment => (
                          <tr key={payment.id} className={`transition ${theme === 'dark' ? 'hover:bg-slate-950/40' : 'hover:bg-[#FDFBF7]'}`}>
                            <td className="p-4 text-gray-500 font-medium">{new Date(payment.date).toLocaleDateString()}</td>
                            <td className={`p-4 font-bold ${theme === 'dark' ? 'text-white' : 'text-gray-900'}`}>{payment.tenantName}</td>
                            <td className="p-4">
                              {payment.messageCode ? <span className={`font-mono text-[11px] px-2 py-1 rounded border uppercase font-bold ${theme === 'dark' ? 'bg-white/5 text-slate-300 border-white/10' : 'bg-black/5 text-gray-600 border-black/10'}`}>{payment.messageCode}</span> : <span className="text-xs text-gray-400 font-medium">N/A</span>}
                            </td>
                            <td className={`p-4 font-bold ${theme === 'dark' ? 'text-slate-300' : 'text-gray-600'}`}>{payment.type === 'COMBINED' ? 'Rent & Water' : payment.type}</td>
                            <td className={`p-4 font-mono font-black ${theme === 'dark' ? 'text-white' : 'text-gray-900'}`}>{formatKes(payment.amount)}</td>
                            <td className="p-4">
                              {payment.excessAmount ? <span className={`text-[10px] border px-2.5 py-1 rounded-md font-bold uppercase tracking-wider ${theme === 'dark' ? 'bg-gray-700/30 text-gray-300 border-gray-600' : 'bg-gray-800/10 text-gray-800 border-gray-800/20'}`}>Excess of {formatKes(payment.excessAmount)}</span> : <span className="text-xs text-gray-400 font-medium">-</span>}
                            </td>
                            <td className="p-4">
                              {payment.status === 'CONFIRMED' ? <span className={`text-xs font-bold flex items-center gap-1.5 ${theme === 'dark' ? 'text-emerald-400' : 'text-emerald-600'}`}><Check size={16}/> Confirmed</span> : <span className={`text-xs font-bold flex items-center gap-1.5 ${theme === 'dark' ? 'text-amber-400' : 'text-amber-600'}`}><Clock size={16}/> Pending</span>}
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </div>
              </div>
            )}

            {activeTab === 'expenses' && (
              <div className="space-y-6">
                <div className="flex flex-col sm:flex-row sm:items-end justify-between gap-3">
                  <div><p className="text-sm text-gray-500">Track property operating costs and approval state.</p><h3 className={`text-xl font-semibold mt-1 ${theme === 'dark' ? 'text-white' : 'text-gray-900'}`}>Expenses</h3></div>
                  {can(PERMISSIONS.CREATE_EXPENSES) && <button onClick={() => { setModalError(''); setIsExpenseModalOpen(true); }} className="bg-gray-800 text-white px-4 py-2.5 rounded-lg text-sm font-semibold flex items-center gap-2"><Plus size={16}/> Add expense</button>}
                </div>
                <div className={`border rounded-lg overflow-hidden ${theme === 'dark' ? 'bg-[#0A0A0A] border-[#262626]' : 'bg-white border-[#E5E5E5]'}`}>
                  <div className="overflow-x-auto"><table className="w-full text-left text-sm"><thead className={`${theme === 'dark' ? 'bg-[#111111] text-[#A3A3A3]' : 'bg-[#F7F7F5] text-gray-500'}`}><tr><th className="p-3 font-semibold">Date</th><th className="p-3 font-semibold">Description</th><th className="p-3 font-semibold">Category</th><th className="p-3 font-semibold">Recorded by</th><th className="p-3 font-semibold">Amount</th><th className="p-3 font-semibold">Status</th></tr></thead><tbody className="divide-y divide-inherit">{expenses.length === 0 ? <tr><td colSpan="6" className="p-8 text-center text-gray-500">No expenses have been recorded yet.</td></tr> : expenses.map(expense => <tr key={expense.id} className="hover:bg-black/[0.03] dark:hover:bg-white/[0.03]"><td className="p-3 text-gray-500">{expense.date}</td><td className="p-3 font-medium">{expense.description}</td><td className="p-3 text-gray-500">{expense.category}</td><td className="p-3 text-gray-500">{expense.recordedBy || '—'}</td><td className="p-3 font-semibold">{formatKes(expense.amount)}</td><td className="p-3"><span className={`text-[11px] font-semibold uppercase tracking-wide ${expense.status === 'APPROVED' ? 'text-emerald-700 dark:text-emerald-400' : 'text-amber-700 dark:text-amber-400'}`}>{expense.status || 'PENDING'}</span></td></tr>)}</tbody></table></div>
                </div>
              </div>
            )}

            {activeTab === 'utilities' && (
              <div className="space-y-6">
                <div><p className="text-sm text-gray-500">Water provider invoices and collection coverage.</p><h3 className={`text-xl font-semibold mt-1 ${theme === 'dark' ? 'text-white' : 'text-gray-900'}`}>Utilities</h3></div>
                <div className="grid grid-cols-1 md:grid-cols-3 gap-3"><div className={`p-4 border rounded-lg ${theme === 'dark' ? 'bg-[#0A0A0A] border-[#262626]' : 'bg-white border-[#E5E5E5]'}`}><p className="text-xs text-gray-500">Tenant water collected</p><p className="text-2xl font-semibold mt-1">{formatKes(stats.collectedWaterRev)}</p></div><div className={`p-4 border rounded-lg ${theme === 'dark' ? 'bg-[#0A0A0A] border-[#262626]' : 'bg-white border-[#E5E5E5]'}`}><p className="text-xs text-gray-500">Provider bills</p><p className="text-2xl font-semibold mt-1">{formatKes(stats.totalMasterWaterBills)}</p></div><div className={`p-4 border rounded-lg ${theme === 'dark' ? 'bg-[#0A0A0A] border-[#262626]' : 'bg-white border-[#E5E5E5]'}`}><p className="text-xs text-gray-500">Unallocated reserve</p><p className={`text-2xl font-semibold mt-1 ${stats.waterReserve < 0 ? 'text-rose-700 dark:text-rose-400' : 'text-emerald-700 dark:text-emerald-400'}`}>{formatKes(stats.waterReserve)}</p></div></div>
                <div className={`border rounded-lg overflow-hidden ${theme === 'dark' ? 'bg-[#0A0A0A] border-[#262626]' : 'bg-white border-[#E5E5E5]'}`}><div className="p-4 border-b border-inherit flex items-center justify-between"><h3 className="font-semibold">Provider bills</h3>{role === ROLES.LANDLORD && <button onClick={() => setIsWaterBillModalOpen(true)} className="text-sm text-amber-700 dark:text-amber-400 font-semibold">Log bill</button>}</div><div className="overflow-x-auto"><table className="w-full text-left text-sm"><thead className={`${theme === 'dark' ? 'bg-[#111111] text-[#A3A3A3]' : 'bg-[#F7F7F5] text-gray-500'}`}><tr><th className="p-3">Billing period</th><th className="p-3">Amount</th><th className="p-3">Recorded</th></tr></thead><tbody className="divide-y divide-inherit">{masterWaterBills.length === 0 ? <tr><td colSpan="3" className="p-8 text-center text-gray-500">No utility bills have been logged yet.</td></tr> : masterWaterBills.map(bill => <tr key={bill.id}><td className="p-3 font-medium">{bill.month}</td><td className="p-3 font-semibold">{formatKes(bill.amount)}</td><td className="p-3 text-gray-500">{bill.date ? new Date(bill.date).toLocaleDateString() : '—'}</td></tr>)}</tbody></table></div></div>
              </div>
            )}

            {activeTab === 'reports' && (
              <div className="space-y-6">
                <div><p className="text-sm text-gray-500">Use current records to review operating performance.</p><h3 className={`text-xl font-semibold mt-1 ${theme === 'dark' ? 'text-white' : 'text-gray-900'}`}>Reports</h3></div>
                <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-3">{[['Rent collected', formatKes(stats.collectedRentRev)], ['Outstanding rent', formatKes(Math.max(0, stats.expectedRentRev - stats.collectedRentRev))], ['Operating expenses', formatKes(stats.totalOperatingExpenses)], ['Net operating result', formatKes(stats.netOperatingResult)]].map(([label, value]) => <div key={label} className={`p-4 border rounded-lg ${theme === 'dark' ? 'bg-[#0A0A0A] border-[#262626]' : 'bg-white border-[#E5E5E5]'}`}><p className="text-xs text-gray-500">{label}</p><p className="text-xl font-semibold mt-1">{value}</p></div>)}</div>
                <div className={`border rounded-lg p-5 ${theme === 'dark' ? 'bg-[#0A0A0A] border-[#262626]' : 'bg-white border-[#E5E5E5]'}`}><div className="flex items-center justify-between gap-4"><div><h3 className="font-semibold">Occupancy</h3><p className="text-sm text-gray-500 mt-1">{stats.occupiedUnits} of {stats.totalUnits} units occupied.</p></div><span className="text-3xl font-semibold">{stats.occupancyRate}%</span></div><div className="mt-4 h-2 bg-gray-200 dark:bg-[#262626] rounded-full overflow-hidden"><div className="h-full bg-amber-600" style={{ width: `${stats.occupancyRate}%` }} /></div></div>
                <p className="text-xs text-gray-500">Financial values are calculated from confirmed payment and recorded expense documents. Export permissions are role-controlled; CSV/PDF export is not enabled in this client-only build.</p>
              </div>
            )}

            {activeTab === 'activity' && (
              <div className="space-y-6"><div><p className="text-sm text-gray-500">Immutable operational history for review and accountability.</p><h3 className={`text-xl font-semibold mt-1 ${theme === 'dark' ? 'text-white' : 'text-gray-900'}`}>Activity history</h3></div><div className={`border rounded-lg overflow-hidden ${theme === 'dark' ? 'bg-[#0A0A0A] border-[#262626]' : 'bg-white border-[#E5E5E5]'}`}><div className="divide-y divide-inherit">{activityLogs.length === 0 ? <p className="p-8 text-center text-gray-500">No activity has been recorded yet.</p> : activityLogs.map(log => <div key={log.id} className="p-4 flex flex-col sm:flex-row sm:items-center justify-between gap-2"><div><p className="font-semibold text-sm">{String(log.action || 'Activity').replaceAll('_', ' ')}</p><p className="text-xs text-gray-500 mt-1">{log.entity || 'record'} {log.entityId || ''}</p></div><time className="text-xs text-gray-500">{log.timestamp ? new Date(log.timestamp).toLocaleString('en-KE', { timeZone: DEFAULT_TIMEZONE }) : '—'}</time></div>)}</div></div></div>
            )}

            {activeTab === 'settings' && (
              <div className="space-y-6"><div><p className="text-sm text-gray-500">Workspace defaults and access controls.</p><h3 className={`text-xl font-semibold mt-1 ${theme === 'dark' ? 'text-white' : 'text-gray-900'}`}>Settings</h3></div><div className={`border rounded-lg divide-y divide-inherit ${theme === 'dark' ? 'bg-[#0A0A0A] border-[#262626]' : 'bg-white border-[#E5E5E5]'}`}><div className="p-4 flex items-center gap-3"><SlidersHorizontal size={18} className="text-amber-600"/><div><p className="font-semibold">General</p><p className="text-sm text-gray-500">Currency: {DEFAULT_CURRENCY} · Timezone: {DEFAULT_TIMEZONE}</p></div></div><div className="p-4 flex items-center gap-3"><ShieldCheck size={18} className="text-amber-600"/><div><p className="font-semibold">Access model</p><p className="text-sm text-gray-500">Roles are resolved from Firebase custom claims or protected user profiles.</p></div></div><div className="p-4 flex items-center gap-3"><Database size={18} className="text-amber-600"/><div><p className="font-semibold">Audit and backups</p><p className="text-sm text-gray-500">Audit records are append-only in the normal UI. Configure scheduled Firebase exports for production backup.</p></div></div></div></div>
            )}

            {activeTab === 'repairs' && (
              <div className="space-y-6 animate-in fade-in duration-500">
                <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
                  <h2 className={`text-2xl font-bold ${theme === 'dark' ? 'text-white' : 'text-gray-900'}`}>Repairs & Operations</h2>
                  <div className="flex gap-2">
                    <button onClick={() => { setModalError(''); setIsSepticModalOpen(true); }} className="bg-gray-800 hover:bg-gray-900 text-white px-5 py-2.5 rounded-xl text-sm font-bold flex items-center gap-2 shadow-sm transition-all hover:shadow-md"><Truck size={18}/> Log Septic Cleanout</button>
                    <button onClick={() => { setModalError(''); setIsRepairModalOpen(true); }} className="bg-rose-600 hover:bg-rose-700 text-white px-5 py-2.5 rounded-xl text-sm font-bold flex items-center gap-2 shadow-sm transition-all hover:shadow-md"><Plus size={18}/> Log Issue</button>
                  </div>
                </div>

                <div className={`rounded-2xl border overflow-hidden shadow-sm ${theme === 'dark' ? 'bg-slate-900 border-slate-800' : 'bg-[#F4EFE6] border-[#E8DFCE]'}`}>
                  <div className={`p-5 border-b ${theme === 'dark' ? 'bg-slate-950 border-slate-800' : 'bg-[#FDFBF7] border-[#E8DFCE]'}`}>
                    <h3 className={`font-bold flex items-center gap-2 text-lg ${theme === 'dark' ? 'text-white' : 'text-gray-900'}`}><Wrench size={20}/> House Repairs & Complaints</h3>
                  </div>
                  <div className="overflow-x-auto">
                    <table className="w-full text-left text-sm whitespace-nowrap min-w-150">
                      <thead className={`border-b ${theme === 'dark' ? 'bg-slate-950 border-slate-800 text-slate-400' : 'bg-[#FDFBF7] border-[#E8DFCE] text-gray-500'}`}>
                        <tr>
                          <th className="p-4 font-bold">Date Logged</th>
                          <th className="p-4 font-bold">House Unit</th>
                          <th className="p-4 font-bold">Description</th>
                          <th className="p-4 font-bold">Status</th>
                          <th className="p-4 font-bold">Resolution Cost</th>
                          <th className="p-4 font-bold text-right">Action</th>
                        </tr>
                      </thead>
                      <tbody className={`divide-y ${theme === 'dark' ? 'divide-slate-800' : 'divide-[#E8DFCE]'}`}>
                        {repairs.length === 0 && (
                          <tr><td colSpan="6" className="p-8 text-center text-gray-500 font-medium">No issues reported!</td></tr>
                        )}
                        {filteredRepairs.map(repair => {
                          const house = houses.find(h => h.id === repair.houseId);
                          return (
                            <tr key={repair.id} className={`transition ${theme === 'dark' ? 'hover:bg-slate-950/40' : 'hover:bg-[#FDFBF7]'}`}>
                              <td className="p-4 text-gray-500 font-medium">{new Date(repair.date).toLocaleDateString()}</td>
                              <td className={`p-4 font-bold ${theme === 'dark' ? 'text-white' : 'text-gray-900'}`}>{house ? house.name : 'Unknown'}</td>
                              <td className={`p-4 whitespace-normal max-w-xs font-medium ${theme === 'dark' ? 'text-slate-300' : 'text-gray-600'}`}>{repair.description}</td>
                              <td className="p-4">{repair.status === 'OPEN' ? <span className={`text-[10px] font-bold px-2.5 py-1 uppercase tracking-wider rounded-md border ${theme === 'dark' ? 'bg-rose-500/10 border-rose-500/20 text-rose-400' : 'bg-rose-500/10 border-rose-500/20 text-rose-600'}`}>Needs Action</span> : <span className={`text-xs font-bold ${theme === 'dark' ? 'text-emerald-400' : 'text-emerald-600'}`}>Resolved</span>}</td>
                              <td className={`p-4 font-mono font-black ${theme === 'dark' ? 'text-white' : 'text-gray-900'}`}>{repair.status === 'RESOLVED' && repair.cost ? formatKes(repair.cost) : 'N/A'}</td>
                              <td className="p-4 text-right">
                                {repair.status === 'OPEN' && (
                                  <button onClick={() => { setModalError(''); setSelectedRepair(repair); setIsResolveRepairModalOpen(true); }} className={`text-xs font-bold px-4 py-2 rounded-lg border transition-colors ${theme === 'dark' ? 'text-gray-300 hover:text-white bg-white/5 border-white/10' : 'text-gray-800 hover:text-gray-900 bg-black/5 border-black/10'}`}>Mark Resolved</button>
                                )}
                              </td>
                            </tr>
                          )
                        })}
                      </tbody>
                    </table>
                  </div>
                </div>

                <div className={`rounded-2xl border overflow-hidden shadow-sm mt-8 ${theme === 'dark' ? 'bg-slate-900 border-slate-800' : 'bg-[#F4EFE6] border-[#E8DFCE]'}`}>
                  <div className={`p-5 border-b ${theme === 'dark' ? 'bg-slate-950 border-slate-800' : 'bg-[#FDFBF7] border-[#E8DFCE]'}`}>
                    <h3 className={`font-bold flex items-center gap-2 text-lg ${theme === 'dark' ? 'text-white' : 'text-gray-900'}`}><Truck size={20}/> Septic Removal Logs</h3>
                  </div>
                  <div className="overflow-x-auto">
                    <table className="w-full text-left text-sm whitespace-nowrap min-w-125">
                      <thead className={`border-b ${theme === 'dark' ? 'bg-slate-950 border-slate-800 text-slate-400' : 'bg-[#FDFBF7] border-[#E8DFCE] text-gray-500'}`}>
                        <tr>
                          <th className="p-4 font-bold">Date Logged</th>
                          <th className="p-4 font-bold">Service Provider</th>
                          <th className="p-4 font-bold">Cost Outlaid</th>
                          <th className="p-4 font-bold">Logged By</th>
                        </tr>
                      </thead>
                      <tbody className={`divide-y ${theme === 'dark' ? 'divide-slate-800' : 'divide-[#E8DFCE]'}`}>
                        {septicLogs.length === 0 && (
                          <tr><td colSpan="4" className="p-8 text-center text-gray-500 font-medium">No septic cleanouts logged yet.</td></tr>
                        )}
                        {septicLogs.map(log => (
                          <tr key={log.id} className={`transition ${theme === 'dark' ? 'hover:bg-slate-950/40' : 'hover:bg-[#FDFBF7]'}`}>
                            <td className="p-4 text-gray-500 font-medium">{new Date(log.date).toLocaleDateString()}</td>
                            <td className={`p-4 font-bold ${theme === 'dark' ? 'text-white' : 'text-gray-900'}`}>{log.provider}</td>
                            <td className={`p-4 font-mono font-black ${theme === 'dark' ? 'text-rose-500' : 'text-rose-600'}`}>{formatKes(log.cost)}</td>
                            <td className="p-4 text-gray-500 font-medium">{log.loggedBy}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </div>
              </div>
            )}
          </div>

          <footer className={`mt-10 py-6 border-t text-center text-sm font-medium flex flex-col gap-1 items-center justify-center transition-colors ${theme === 'dark' ? 'border-slate-800 text-slate-500' : 'border-[#E8DFCE] text-gray-500'}`}>
            <p>&copy; {new Date().getFullYear()} Ruiru Rentals. All rights reserved.</p>
            <p className="text-xs opacity-70">@Gikunju creates</p>
          </footer>

        </main>
      </div>

      {/* ================= STRICT MODALS ================= */}
      
      {modalError && (
        <div className="fixed top-4 right-4 bg-rose-600 text-white p-4 rounded-2xl shadow-2xl z-100 flex items-center gap-3 animate-in fade-in slide-in-from-top-4 max-w-sm">
          <AlertCircle size={24}/>
          <div className="flex-1">
            <p className="text-sm font-bold">Operation Issue</p>
            <p className="text-xs opacity-90 font-medium mt-0.5">{modalError}</p>
          </div>
          <button onClick={() => setModalError('')} className="ml-2 p-1 opacity-70 hover:opacity-100 bg-white/10 rounded-lg"><X size={16}/></button>
        </div>
      )}

      {isExpenseModalOpen && (
        <div className="fixed inset-0 bg-black/60 flex items-center justify-center p-4 z-60" role="presentation" onClick={() => closeAnyModal(setIsExpenseModalOpen)}>
          <div className={`w-full max-w-lg p-6 rounded-xl border shadow-2xl ${theme === 'dark' ? 'bg-[#111111] border-[#303030] text-white' : 'bg-white border-[#E5E5E5] text-gray-900'}`} role="dialog" aria-modal="true" aria-labelledby="expense-dialog-title" onClick={e => e.stopPropagation()}>
            <div className="flex items-center justify-between mb-5"><div><h3 id="expense-dialog-title" className="text-lg font-semibold">Add expense</h3><p className="text-xs text-gray-500 mt-1">{role === ROLES.LANDLORD ? 'This record will be marked approved.' : 'This record will wait for landlord review.'}</p></div><button onClick={() => closeAnyModal(setIsExpenseModalOpen)} className="p-2 rounded-lg hover:bg-black/5 dark:hover:bg-white/5" aria-label="Close expense dialog"><X size={18}/></button></div>
            <form onSubmit={handleAddExpense} className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <div className="sm:col-span-2"><label className="block text-xs font-semibold text-gray-500 mb-1.5" htmlFor="expense-description">Description</label><input id="expense-description" name="description" required maxLength="160" className={`w-full p-2.5 rounded-lg border text-sm outline-none focus:ring-2 focus:ring-amber-600/40 ${theme === 'dark' ? 'bg-[#0A0A0A] border-[#303030]' : 'bg-white border-[#E5E5E5]'}`} /></div>
              <div><label className="block text-xs font-semibold text-gray-500 mb-1.5" htmlFor="expense-category">Category</label><select id="expense-category" name="category" required className={`w-full p-2.5 rounded-lg border text-sm outline-none focus:ring-2 focus:ring-amber-600/40 ${theme === 'dark' ? 'bg-[#0A0A0A] border-[#303030]' : 'bg-white border-[#E5E5E5]'}`}><option>Repairs</option><option>Maintenance</option><option>Utilities</option><option>Security</option><option>Cleaning</option><option>Supplies</option><option>Insurance</option><option>Other</option></select></div>
              <div><label className="block text-xs font-semibold text-gray-500 mb-1.5" htmlFor="expense-amount">Amount ({DEFAULT_CURRENCY})</label><input id="expense-amount" name="amount" required min="0.01" step="0.01" type="number" className={`w-full p-2.5 rounded-lg border text-sm outline-none focus:ring-2 focus:ring-amber-600/40 ${theme === 'dark' ? 'bg-[#0A0A0A] border-[#303030]' : 'bg-white border-[#E5E5E5]'}`} /></div>
              <div><label className="block text-xs font-semibold text-gray-500 mb-1.5" htmlFor="expense-date">Date</label><input id="expense-date" name="date" required type="date" defaultValue={new Date().toISOString().slice(0, 10)} className={`w-full p-2.5 rounded-lg border text-sm outline-none focus:ring-2 focus:ring-amber-600/40 ${theme === 'dark' ? 'bg-[#0A0A0A] border-[#303030]' : 'bg-white border-[#E5E5E5]'}`} /></div>
              <div><label className="block text-xs font-semibold text-gray-500 mb-1.5" htmlFor="expense-payment-method">Payment method</label><select id="expense-payment-method" name="paymentMethod" className={`w-full p-2.5 rounded-lg border text-sm outline-none focus:ring-2 focus:ring-amber-600/40 ${theme === 'dark' ? 'bg-[#0A0A0A] border-[#303030]' : 'bg-white border-[#E5E5E5]'}`}><option>Cash</option><option>Bank</option><option>M-Pesa</option><option>Other</option></select></div>
              <div className="sm:col-span-2"><label className="block text-xs font-semibold text-gray-500 mb-1.5" htmlFor="expense-vendor">Vendor (optional)</label><input id="expense-vendor" name="vendor" maxLength="120" className={`w-full p-2.5 rounded-lg border text-sm outline-none focus:ring-2 focus:ring-amber-600/40 ${theme === 'dark' ? 'bg-[#0A0A0A] border-[#303030]' : 'bg-white border-[#E5E5E5]'}`} /></div>
              <button type="submit" disabled={isProcessing} className="sm:col-span-2 bg-gray-800 text-white p-2.5 rounded-lg text-sm font-semibold disabled:opacity-50">{isProcessing ? 'Saving…' : 'Save expense'}</button>
            </form>
          </div>
        </div>
      )}

      {isHouseModalOpen && (
        <div className="fixed inset-0 bg-black/60 flex items-center justify-center p-4 z-60 backdrop-blur-sm transition-opacity" onClick={() => closeAnyModal(setIsHouseModalOpen)}>
          <div className={`rounded-3xl w-full max-w-md p-7 shadow-2xl animate-in fade-in zoom-in-95 duration-200 ${theme === 'dark' ? 'bg-slate-900 border border-slate-800 text-white' : 'bg-[#FDFBF7] border border-[#E8DFCE] text-gray-900'}`} onClick={e => e.stopPropagation()}>
            <div className="flex justify-between items-center mb-6">
              <h3 className="text-xl font-bold">Add Property Unit</h3>
              <button onClick={() => closeAnyModal(setIsHouseModalOpen)} className={`p-2 rounded-full ${theme === 'dark' ? 'hover:bg-white/5 text-gray-400 hover:text-white' : 'hover:bg-black/5 text-gray-500 hover:text-gray-900'}`}><X/></button>
            </div>
            <form onSubmit={handleAddHouse} className="space-y-5">
              <div>
                <label className="block text-xs font-bold text-gray-500 uppercase tracking-wider mb-2">Unit Name / Number</label>
                <input required name="name" className={`w-full border rounded-xl p-3 outline-none focus:ring-2 focus:ring-gray-800 dark:focus:ring-gray-500 font-medium transition-all ${theme === 'dark' ? 'bg-slate-950 border-slate-800 text-white' : 'bg-[#F4EFE6] border-[#DCD4C6] text-gray-900'}`} placeholder="e.g. Unit A1, House B" />
              </div>
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="block text-xs font-bold text-gray-500 uppercase tracking-wider mb-2">Type</label>
                  <select name="type" className={`w-full border rounded-xl p-3 outline-none focus:ring-2 focus:ring-gray-800 dark:focus:ring-gray-500 text-sm font-medium transition-all ${theme === 'dark' ? 'bg-slate-950 border-slate-800 text-white' : 'bg-[#F4EFE6] border-[#DCD4C6] text-gray-900'}`}>
                    <option>Single Room</option>
                    <option>Double Room</option>
                  </select>
                </div>
                <div>
                  <label className="block text-xs font-bold text-gray-500 uppercase tracking-wider mb-2">Target Rent (KES)</label>
                  <input required name="rent" type="number" className={`w-full border rounded-xl p-3 outline-none focus:ring-2 focus:ring-gray-800 dark:focus:ring-gray-500 font-bold transition-all ${theme === 'dark' ? 'bg-slate-950 border-slate-800 text-white' : 'bg-[#F4EFE6] border-[#DCD4C6] text-gray-900'}`} placeholder="e.g. 15000" />
                </div>
              </div>
              <button type="submit" disabled={isProcessing} className="w-full bg-gray-800 hover:bg-gray-900 text-white font-bold py-3.5 rounded-xl mt-6 disabled:opacity-50 transition-all shadow-md hover:shadow-lg">
                {isProcessing ? 'Saving Unit...' : 'Save Unit'}
              </button>
            </form>
          </div>
        </div>
      )}

      {isTenantModalOpen && (
        <div className="fixed inset-0 bg-black/60 flex items-center justify-center p-4 z-60 backdrop-blur-sm transition-opacity" onClick={() => closeAnyModal(setIsTenantModalOpen)}>
          <div className={`rounded-3xl w-full max-w-md p-7 shadow-2xl animate-in fade-in zoom-in-95 duration-200 ${theme === 'dark' ? 'bg-slate-900 border border-slate-800 text-white' : 'bg-[#FDFBF7] border border-[#E8DFCE] text-gray-900'}`} onClick={e => e.stopPropagation()}>
            <div className="flex justify-between items-center mb-6">
              <h3 className="text-xl font-bold">Register New Tenant</h3>
              <button onClick={() => closeAnyModal(setIsTenantModalOpen)} className={`p-2 rounded-full ${theme === 'dark' ? 'hover:bg-white/5 text-gray-400 hover:text-white' : 'hover:bg-black/5 text-gray-500 hover:text-gray-900'}`}><X/></button>
            </div>
            <form onSubmit={handleAddTenant} className="space-y-4">
              <div className="grid grid-cols-2 gap-4">
                <div className="col-span-2">
                  <label className="block text-xs font-bold text-gray-500 uppercase tracking-wider mb-2">Full Name</label>
                  <input required name="name" className={`w-full border rounded-xl p-3 outline-none focus:ring-2 focus:ring-gray-800 dark:focus:ring-gray-500 font-medium text-sm transition-all ${theme === 'dark' ? 'bg-slate-950 border-slate-800 text-white' : 'bg-[#F4EFE6] border-[#DCD4C6] text-gray-900'}`} />
                </div>
                <div>
                  <label className="block text-xs font-bold text-gray-500 uppercase tracking-wider mb-2">Phone Number</label>
                  <input required name="phone" className={`w-full border rounded-xl p-3 outline-none focus:ring-2 focus:ring-gray-800 dark:focus:ring-gray-500 font-medium text-sm transition-all ${theme === 'dark' ? 'bg-slate-950 border-slate-800 text-white' : 'bg-[#F4EFE6] border-[#DCD4C6] text-gray-900'}`} />
                </div>
                <div>
                  <label className="block text-xs font-bold text-gray-500 uppercase tracking-wider mb-2">Comm. Pref</label>
                  <select name="contactPref" className={`w-full border rounded-xl p-3 outline-none focus:ring-2 focus:ring-gray-800 dark:focus:ring-gray-500 text-sm font-medium transition-all ${theme === 'dark' ? 'bg-slate-950 border-slate-800 text-white' : 'bg-[#F4EFE6] border-[#DCD4C6] text-gray-900'}`}>
                    <option>SMS Text</option>
                    <option>Phone Call</option>
                    <option>Face-to-Face</option>
                  </select>
                </div>
                <div className="col-span-2">
                  <label className="block text-xs font-bold text-gray-500 uppercase tracking-wider mb-2">Assign House Unit (Vacant only)</label>
                  <select required name="houseId" className={`w-full border rounded-xl p-3 outline-none focus:ring-2 focus:ring-gray-800 dark:focus:ring-gray-500 text-sm font-bold transition-all ${theme === 'dark' ? 'bg-slate-950 border-slate-800 text-white' : 'bg-[#F4EFE6] border-[#DCD4C6] text-gray-900'}`}>
                    <option value="">-- Select Vacant Unit --</option>
                    {houses.filter(h => h.status === 'VACANT' && !occupiedHouseIds.has(h.id)).map(h => (
                      <option key={h.id} value={h.id}>{h.name} ({formatKes(h.rent)})</option>
                    ))}
                  </select>
                </div>
                <div>
                  <label className="block text-xs font-bold text-gray-500 uppercase tracking-wider mb-2">Start Rent Bill</label>
                  <input required name="expectedRent" type="number" defaultValue="0" className={`w-full border rounded-xl p-3 outline-none focus:ring-2 focus:ring-gray-800 dark:focus:ring-gray-500 font-bold text-sm transition-all ${theme === 'dark' ? 'bg-slate-950 border-slate-800 text-white' : 'bg-[#F4EFE6] border-[#DCD4C6] text-gray-900'}`} />
                </div>
                <div>
                  <label className="block text-xs font-bold text-gray-500 uppercase tracking-wider mb-2">Start Water Bill</label>
                  <input required name="expectedWater" type="number" defaultValue="0" className={`w-full border rounded-xl p-3 outline-none focus:ring-2 focus:ring-gray-800 dark:focus:ring-gray-500 font-bold text-sm transition-all ${theme === 'dark' ? 'bg-slate-950 border-slate-800 text-white' : 'bg-[#F4EFE6] border-[#DCD4C6] text-gray-900'}`} />
                </div>
              </div>
              <button type="submit" disabled={isProcessing} className="w-full bg-gray-800 hover:bg-gray-900 text-white font-bold py-3.5 rounded-xl mt-6 disabled:opacity-50 transition-all shadow-md hover:shadow-lg">
                {isProcessing ? 'Saving Details...' : 'Save Tenant'}
              </button>
            </form>
          </div>
        </div>
      )}

      {isEditTenantModalOpen && selectedTenantForDetails && (
        <div className="fixed inset-0 bg-black/60 flex items-center justify-center p-4 z-70 backdrop-blur-sm transition-opacity" onClick={() => closeAnyModal(setIsEditTenantModalOpen)}>
          <div className={`rounded-3xl w-full max-w-md p-7 shadow-2xl animate-in fade-in zoom-in-95 duration-200 ${theme === 'dark' ? 'bg-slate-900 text-white border border-slate-800' : 'bg-[#FDFBF7] text-gray-900 border border-[#E8DFCE]'}`} onClick={e => e.stopPropagation()}>
            <div className="flex justify-between items-center mb-6">
              <h3 className="text-xl font-bold">Edit Tenant Details</h3>
              <button onClick={() => closeAnyModal(setIsEditTenantModalOpen)} className={`p-2 rounded-full ${theme === 'dark' ? 'hover:bg-white/5 text-gray-400 hover:text-white' : 'hover:bg-black/5 text-gray-500 hover:text-gray-900'}`}><X/></button>
            </div>
            <form onSubmit={handleEditTenant} className="space-y-4">
              <div>
                <label className="block text-xs font-bold text-gray-500 uppercase tracking-wider mb-2">Full Name</label>
                <input required name="name" defaultValue={selectedTenantForDetails.name} className={`w-full border rounded-xl p-3 outline-none focus:ring-2 focus:ring-gray-800 dark:focus:ring-gray-500 font-medium text-sm transition-all ${theme === 'dark' ? 'bg-slate-950 border-slate-800 text-white' : 'bg-[#F4EFE6] border-[#DCD4C6] text-gray-900'}`} />
              </div>
              <div className="grid grid-cols-2 gap-4">
                <div className="col-span-2">
                  <label className="block text-xs font-bold text-gray-500 uppercase tracking-wider mb-2">Move To New House (Optional)</label>
                  <select name="houseId" defaultValue={selectedTenantForDetails.houseId} className={`w-full border rounded-xl p-3 outline-none focus:ring-2 focus:ring-gray-800 dark:focus:ring-gray-500 text-sm font-bold transition-all ${theme === 'dark' ? 'bg-slate-950 border-slate-800 text-white' : 'bg-[#F4EFE6] border-[#DCD4C6] text-gray-900'}`}>
                    <option value={selectedTenantForDetails.houseId}>Keep Current Unit ({houses.find(h => h.id === selectedTenantForDetails.houseId)?.name || 'Unassigned'})</option>
                    {houses.filter(h => h.status === 'VACANT' && !occupiedHouseIds.has(h.id)).map(h => (
                      <option key={h.id} value={h.id}>Move to: {h.name}</option>
                    ))}
                  </select>
                </div>
                <div>
                  <label className="block text-xs font-bold text-gray-500 uppercase tracking-wider mb-2">Phone Number</label>
                  <input required name="phone" defaultValue={selectedTenantForDetails.phone} className={`w-full border rounded-xl p-3 outline-none focus:ring-2 focus:ring-gray-800 dark:focus:ring-gray-500 font-medium text-sm transition-all ${theme === 'dark' ? 'bg-slate-950 border-slate-800 text-white' : 'bg-[#F4EFE6] border-[#DCD4C6] text-gray-900'}`} />
                </div>
                <div>
                  <label className="block text-xs font-bold text-gray-500 uppercase tracking-wider mb-2">Comm. Pref</label>
                  <select name="contactPref" defaultValue={selectedTenantForDetails.contactPref} className={`w-full border rounded-xl p-3 outline-none focus:ring-2 focus:ring-gray-800 dark:focus:ring-gray-500 text-sm font-medium transition-all ${theme === 'dark' ? 'bg-slate-950 border-slate-800 text-white' : 'bg-[#F4EFE6] border-[#DCD4C6] text-gray-900'}`}>
                    <option>SMS Text</option><option>Phone Call</option><option>Face-to-Face</option>
                  </select>
                </div>
                <div>
                  <label className="block text-xs font-bold text-gray-500 uppercase tracking-wider mb-2">Expected Rent Target</label>
                  <input required name="expectedRent" type="number" defaultValue={selectedTenantForDetails.expectedRent} className={`w-full border rounded-xl p-3 outline-none focus:ring-2 focus:ring-gray-800 dark:focus:ring-gray-500 font-bold text-sm transition-all ${theme === 'dark' ? 'bg-slate-950 border-slate-800 text-white' : 'bg-[#F4EFE6] border-[#DCD4C6] text-gray-900'}`} />
                </div>
                <div>
                  <label className="block text-xs font-bold text-gray-500 uppercase tracking-wider mb-2">Expected Water Target</label>
                  <input required name="expectedWater" type="number" defaultValue={selectedTenantForDetails.expectedWater} className={`w-full border rounded-xl p-3 outline-none focus:ring-2 focus:ring-gray-800 dark:focus:ring-gray-500 font-bold text-sm transition-all ${theme === 'dark' ? 'bg-slate-950 border-slate-800 text-white' : 'bg-[#F4EFE6] border-[#DCD4C6] text-gray-900'}`} />
                </div>
              </div>
              <button type="submit" disabled={isProcessing} className="w-full bg-gray-800 hover:bg-gray-900 text-white font-bold py-3.5 rounded-xl mt-6 flex items-center justify-center gap-2 disabled:opacity-50 transition-all shadow-md hover:shadow-lg">
                 {isProcessing ? 'Updating...' : 'Save Changes'}
              </button>
            </form>
          </div>
        </div>
      )}

      {isPaymentModalOpen && selectedTenant && (
        <div className="fixed inset-0 bg-black/60 flex items-center justify-center p-4 z-60 backdrop-blur-sm transition-opacity" onClick={() => closeAnyModal(setIsPaymentModalOpen)}>
          <div className={`rounded-3xl w-full max-w-md p-7 shadow-2xl animate-in fade-in zoom-in-95 duration-200 ${theme === 'dark' ? 'bg-slate-900 border border-slate-800 text-white' : 'bg-[#FDFBF7] border border-[#E8DFCE] text-gray-900'}`} onClick={e => e.stopPropagation()}>
            <div className="flex justify-between items-center mb-6">
              <h3 className="text-xl font-bold">Log Payment</h3>
              <button onClick={() => closeAnyModal(setIsPaymentModalOpen)} className={`p-2 rounded-full ${theme === 'dark' ? 'hover:bg-white/5 text-gray-400 hover:text-white' : 'hover:bg-black/5 text-gray-500 hover:text-gray-900'}`}><X/></button>
            </div>
            
            <div className={`p-4 rounded-xl mb-6 text-sm border flex justify-between items-center gap-2 shadow-inner ${theme === 'dark' ? 'bg-slate-950 border-slate-800 text-slate-300' : 'bg-[#F4EFE6] border-[#DCD4C6] text-gray-700'}`}>
              <div><p className="font-medium">Tenant: <strong className={`text-base block mt-0.5 ${theme === 'dark' ? 'text-white' : 'text-gray-900'}`}>{selectedTenant.name}</strong></p></div>
              <div className="text-right shrink-0 whitespace-nowrap text-xs">
                <p className="font-medium">Owes Rent: <strong className={`font-bold ${theme === 'dark' ? 'text-rose-500' : 'text-rose-600'}`}>{formatKes(selectedTenant.expectedRent - selectedTenant.paidRent)}</strong></p>
                <p className="font-medium mt-0.5">Owes Water: <strong className={`font-bold ${theme === 'dark' ? 'text-rose-500' : 'text-rose-600'}`}>{formatKes(selectedTenant.expectedWater - selectedTenant.paidWater)}</strong></p>
              </div>
            </div>
            
            <form onSubmit={handleLogPayment} className="space-y-5">
              <div>
                <label className="block text-xs font-bold text-gray-500 uppercase tracking-wider mb-2">Transaction Ref / Code</label>
                <input required name="messageCode" type="text" placeholder="e.g. QKX2T1... or 'CASH'" className={`w-full border rounded-xl p-3 outline-none focus:ring-2 focus:ring-gray-800 dark:focus:ring-gray-500 font-mono uppercase font-bold transition-all ${theme === 'dark' ? 'bg-slate-950 border-slate-800 text-white' : 'bg-[#F4EFE6] border-[#DCD4C6] text-gray-900'}`} />
              </div>
              <div>
                <label className="block text-xs font-bold text-gray-500 uppercase tracking-wider mb-2">Amount Paid (KES)</label>
                <input required name="amount" type="number" className={`w-full border rounded-xl p-3 outline-none focus:ring-2 focus:ring-gray-800 dark:focus:ring-gray-500 font-black text-xl transition-all ${theme === 'dark' ? 'bg-slate-950 border-slate-800 text-white' : 'bg-[#F4EFE6] border-[#DCD4C6] text-gray-900'}`} />
              </div>
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="block text-xs font-bold text-gray-500 uppercase tracking-wider mb-2">Paying For</label>
                  <select name="type" className={`w-full border rounded-xl p-3 outline-none focus:ring-2 focus:ring-gray-800 dark:focus:ring-gray-500 text-sm font-bold transition-all ${theme === 'dark' ? 'bg-slate-950 border-slate-800 text-white' : 'bg-[#F4EFE6] border-[#DCD4C6] text-gray-900'}`}>
                    <option value="COMBINED">Rent & Water Combined</option>
                    <option value="RENT">Rent Only</option>
                    <option value="WATER">Water Only</option>
                  </select>
                </div>
                <div>
                  <label className="block text-xs font-bold text-gray-500 uppercase tracking-wider mb-2">Method</label>
                  <select name="method" className={`w-full border rounded-xl p-3 outline-none focus:ring-2 focus:ring-gray-800 dark:focus:ring-gray-500 text-sm font-bold transition-all ${theme === 'dark' ? 'bg-slate-950 border-slate-800 text-white' : 'bg-[#F4EFE6] border-[#DCD4C6] text-gray-900'}`}>
                    {paymentMethods.map(methodOption => <option key={methodOption}>{methodOption}</option>)}
                  </select>
                </div>
              </div>
              <button type="submit" disabled={isProcessing} className="w-full bg-gray-800 hover:bg-gray-900 text-white font-bold py-3.5 rounded-xl mt-6 flex items-center justify-center gap-2 disabled:opacity-50 transition-all shadow-md hover:shadow-lg">
                <FileText size={18}/> {isProcessing ? 'Logging...' : (role === 'MANAGER' ? 'Submit for Landlord Review' : 'Log & Confirm Receipt')}
              </button>
            </form>
          </div>
        </div>
      )}

      {isBillingModalOpen && selectedTenant && (
        <div className="fixed inset-0 bg-black/60 flex items-center justify-center p-4 z-60 backdrop-blur-sm transition-opacity" onClick={() => closeAnyModal(setIsBillingModalOpen)}>
          <div className={`rounded-3xl w-full max-w-sm p-7 shadow-2xl animate-in fade-in zoom-in-95 duration-200 ${theme === 'dark' ? 'bg-slate-900 border border-slate-800 text-white' : 'bg-[#FDFBF7] border border-[#E8DFCE] text-gray-900'}`} onClick={e => e.stopPropagation()}>
            <div className="flex justify-between items-center mb-4">
              <h3 className="text-xl font-bold">Add Monthly Charges</h3>
              <button onClick={() => closeAnyModal(setIsBillingModalOpen)} className={`p-2 rounded-full ${theme === 'dark' ? 'hover:bg-white/5 text-gray-400 hover:text-white' : 'hover:bg-black/5 text-gray-500 hover:text-gray-900'}`}><X/></button>
            </div>
            <p className="text-xs text-gray-500 font-medium mb-6">Post charges directly onto {selectedTenant.name}'s account.</p>
            <form onSubmit={handleUpdateBills} className="space-y-5">
              <div>
                <label className="block text-xs font-bold text-gray-500 uppercase tracking-wider mb-2">New Rent Charge (KES)</label>
                <input required name="addRent" type="number" defaultValue="0" className={`w-full border rounded-xl p-3 outline-none focus:ring-2 focus:ring-gray-800 dark:focus:ring-gray-500 font-bold transition-all ${theme === 'dark' ? 'bg-slate-950 border-slate-800 text-white' : 'bg-[#F4EFE6] border-[#DCD4C6] text-gray-900'}`} />
              </div>
              <div>
                <label className="block text-xs font-bold text-gray-500 uppercase tracking-wider mb-2">New Water Charge (KES)</label>
                <input required name="addWater" type="number" defaultValue="0" className={`w-full border rounded-xl p-3 outline-none focus:ring-2 focus:ring-gray-800 dark:focus:ring-gray-500 font-bold transition-all ${theme === 'dark' ? 'bg-slate-950 border-slate-800 text-white' : 'bg-[#F4EFE6] border-[#DCD4C6] text-gray-900'}`} />
              </div>
              <button type="submit" disabled={isProcessing} className="w-full bg-gray-800 hover:bg-gray-900 text-white font-bold py-3.5 rounded-xl mt-6 disabled:opacity-50 transition-all shadow-md hover:shadow-lg">
                {isProcessing ? 'Updating Ledger...' : 'Add Charges'}
              </button>
            </form>
          </div>
        </div>
      )}

      {isRepairModalOpen && (
        <div className="fixed inset-0 bg-black/60 flex items-center justify-center p-4 z-60 backdrop-blur-sm transition-opacity" onClick={() => closeAnyModal(setIsRepairModalOpen)}>
          <div className={`rounded-3xl w-full max-w-md p-7 shadow-2xl animate-in fade-in zoom-in-95 duration-200 ${theme === 'dark' ? 'bg-slate-900 border border-slate-800 text-white' : 'bg-[#FDFBF7] border border-[#E8DFCE] text-gray-900'}`} onClick={e => e.stopPropagation()}>
            <div className={`flex justify-between items-center mb-6 border-b pb-4 ${theme === 'dark' ? 'border-slate-800' : 'border-[#DCD4C6]'}`}>
              <h3 className="text-xl font-bold">Log Repair / Complaint</h3>
              <button onClick={() => closeAnyModal(setIsRepairModalOpen)} className={`p-2 rounded-full ${theme === 'dark' ? 'hover:bg-white/5 text-gray-400 hover:text-white' : 'hover:bg-black/5 text-gray-500 hover:text-gray-900'}`}><X/></button>
            </div>
            <form onSubmit={handleLogRepair} className="space-y-5">
              <div>
                <label className="block text-xs font-bold text-gray-500 uppercase tracking-wider mb-2">Select House Unit</label>
                <select required name="houseId" className={`w-full border rounded-xl p-3 outline-none focus:ring-2 focus:ring-rose-500 text-sm font-bold transition-all ${theme === 'dark' ? 'bg-slate-950 border-slate-800 text-white' : 'bg-[#F4EFE6] border-[#DCD4C6] text-gray-900'}`}>
                  <option value="">-- Select House Unit --</option>
                  {houses.map(h => <option key={h.id} value={h.id}>{h.name}</option>)}
                </select>
              </div>
              <div>
                <label className="block text-xs font-bold text-gray-500 uppercase tracking-wider mb-2">Issue Description</label>
                <textarea required name="description" rows="3" placeholder="Describe the maintenance/complaint issue..." className={`w-full border rounded-xl p-3 outline-none focus:ring-2 focus:ring-rose-500 text-sm font-medium transition-all ${theme === 'dark' ? 'bg-slate-950 border-slate-800 text-white' : 'bg-[#F4EFE6] border-[#DCD4C6] text-gray-900'}`}></textarea>
              </div>
              <button type="submit" disabled={isProcessing} className="w-full bg-rose-600 hover:bg-rose-700 text-white font-bold py-3.5 rounded-xl mt-6 disabled:opacity-50 transition-all shadow-md hover:shadow-lg">
                {isProcessing ? 'Logging...' : 'Log Active Issue'}
              </button>
            </form>
          </div>
        </div>
      )}

      {isResolveRepairModalOpen && selectedRepair && (
        <div className="fixed inset-0 bg-black/60 flex items-center justify-center p-4 z-60 backdrop-blur-sm transition-opacity" onClick={() => closeAnyModal(setIsResolveRepairModalOpen)}>
          <div className={`rounded-3xl w-full max-w-sm p-7 shadow-2xl animate-in fade-in zoom-in-95 duration-200 ${theme === 'dark' ? 'bg-slate-900 border border-slate-800 text-white' : 'bg-[#FDFBF7] border border-[#E8DFCE] text-gray-900'}`} onClick={e => e.stopPropagation()}>
            <div className="flex justify-between items-center mb-4">
              <h3 className="text-xl font-bold">Resolve Task</h3>
              <button onClick={() => { setIsResolveRepairModalOpen(false); setSelectedRepair(null); }} className={`p-2 rounded-full ${theme === 'dark' ? 'hover:bg-white/5 text-gray-400 hover:text-white' : 'hover:bg-black/5 text-gray-500 hover:text-gray-900'}`}><X/></button>
            </div>
            <p className="text-xs text-gray-500 font-medium mb-6">Input final outlaid costs associated with: <strong className={theme === 'dark' ? 'text-white' : 'text-gray-900'}>"{selectedRepair.description}"</strong></p>
            <form onSubmit={handleResolveRepairSubmit} className="space-y-5">
              <div>
                <label className="block text-xs font-bold text-gray-500 uppercase tracking-wider mb-2">Resolution Cost (KES)</label>
                <input required name="cost" type="number" placeholder="e.g. 3500" defaultValue="0" className={`w-full border rounded-xl p-3 outline-none focus:ring-2 focus:ring-emerald-500 font-black text-lg transition-all ${theme === 'dark' ? 'bg-slate-950 border-slate-800 text-white' : 'bg-[#F4EFE6] border-[#DCD4C6] text-gray-900'}`} />
              </div>
              <button type="submit" disabled={isProcessing} className="w-full bg-emerald-600 hover:bg-emerald-700 text-white font-bold py-3.5 rounded-xl mt-6 disabled:opacity-50 transition-all shadow-md hover:shadow-lg">
                {isProcessing ? 'Resolving...' : 'Complete Resolution'}
              </button>
            </form>
          </div>
        </div>
      )}

      {isSepticModalOpen && (
        <div className="fixed inset-0 bg-black/60 flex items-center justify-center p-4 z-60 backdrop-blur-sm transition-opacity" onClick={() => closeAnyModal(setIsSepticModalOpen)}>
          <div className={`rounded-3xl w-full max-w-sm p-7 shadow-2xl animate-in fade-in zoom-in-95 duration-200 ${theme === 'dark' ? 'bg-slate-900 border border-slate-800 text-white' : 'bg-[#FDFBF7] border border-[#E8DFCE] text-gray-900'}`} onClick={e => e.stopPropagation()}>
            <div className="flex justify-between items-center mb-4">
              <h3 className="text-xl font-bold">Log Septic Cleanout</h3>
              <button onClick={() => closeAnyModal(setIsSepticModalOpen)} className={`p-2 rounded-full ${theme === 'dark' ? 'hover:bg-white/5 text-gray-400 hover:text-white' : 'hover:bg-black/5 text-gray-500 hover:text-gray-900'}`}><X/></button>
            </div>
            <p className="text-xs text-gray-500 font-medium mb-6">Select the cleanout service dispatched to the plot.</p>
            <form onSubmit={handleLogSeptic} className="space-y-5">
              <div>
                <label className="block text-xs font-bold text-gray-500 uppercase tracking-wider mb-2">Service Provider</label>
                <select required name="provider" className={`w-full border rounded-xl p-3 outline-none focus:ring-2 focus:ring-gray-800 dark:focus:ring-gray-500 text-sm font-bold transition-all ${theme === 'dark' ? 'bg-slate-950 border-slate-800 text-white' : 'bg-[#F4EFE6] border-[#DCD4C6] text-gray-900'}`}>
                  <option value="Rujwasco Official|7000">Rujwasco Official (KES 7,000)</option>
                  <option value="Rujwasco Personal Driver|3500">Rujwasco Personal Driver (KES 3,500)</option>
                  <option value="Private Firm|8500">Private Firm (KES 8,500)</option>
                </select>
              </div>
              <button type="submit" disabled={isProcessing} className="w-full bg-gray-800 hover:bg-gray-900 text-white font-bold py-3.5 rounded-xl mt-6 disabled:opacity-50 transition-all shadow-md hover:shadow-lg">
                {isProcessing ? 'Recording...' : 'Record Expense'}
              </button>
            </form>
          </div>
        </div>
      )}

      {isWaterBillModalOpen && (
        <div className="fixed inset-0 bg-black/60 flex items-center justify-center p-4 z-60 backdrop-blur-sm transition-opacity" onClick={() => closeAnyModal(setIsWaterBillModalOpen)}>
          <div className={`rounded-3xl w-full max-w-sm p-7 shadow-2xl animate-in fade-in zoom-in-95 duration-200 ${theme === 'dark' ? 'bg-slate-900 border border-slate-800 text-white' : 'bg-[#FDFBF7] border border-[#E8DFCE] text-gray-900'}`} onClick={e => e.stopPropagation()}>
            <div className="flex justify-between items-center mb-4">
              <h3 className="text-xl font-bold">Log RUJWASCO Invoice</h3>
              <button onClick={() => closeAnyModal(setIsWaterBillModalOpen)} className={`p-2 rounded-full ${theme === 'dark' ? 'hover:bg-white/5 text-gray-400 hover:text-white' : 'hover:bg-black/5 text-gray-500 hover:text-gray-900'}`}><X/></button>
            </div>
            <p className="text-xs text-gray-500 font-medium mb-6">Compare tenant collections with actual utility provider invoices.</p>
            <form onSubmit={handleLogWaterBill} className="space-y-5">
              <div>
                <label className="block text-xs font-bold text-gray-500 uppercase tracking-wider mb-2">Billing Month</label>
                <input required name="month" type="text" placeholder="e.g. July 2026" className={`w-full border rounded-xl p-3 outline-none focus:ring-2 focus:ring-cyan-600 font-medium text-sm transition-all ${theme === 'dark' ? 'bg-slate-950 border-slate-800 text-white' : 'bg-[#F4EFE6] border-[#DCD4C6] text-gray-900'}`} />
              </div>
              <div>
                <label className="block text-xs font-bold text-gray-500 uppercase tracking-wider mb-2">Invoice Amount (KES)</label>
                <input required name="amount" type="number" className={`w-full border rounded-xl p-3 outline-none focus:ring-2 focus:ring-cyan-600 font-black text-lg transition-all ${theme === 'dark' ? 'bg-slate-950 border-slate-800 text-white' : 'bg-[#F4EFE6] border-[#DCD4C6] text-gray-900'}`} />
              </div>
              <button type="submit" disabled={isProcessing} className="w-full bg-cyan-700 hover:bg-cyan-800 text-white font-bold py-3.5 rounded-xl mt-6 disabled:opacity-50 transition-all shadow-md hover:shadow-lg">
                {isProcessing ? 'Logging...' : 'Log Invoice'}
              </button>
            </form>
          </div>
        </div>
      )}

      {/* Detail Modals (Non-Form) */}
      {selectedTenantForDetails && !isEditTenantModalOpen && (
        <div className="fixed inset-0 bg-black/60 flex items-center justify-center p-4 z-60 backdrop-blur-sm transition-opacity" onClick={() => setSelectedTenantForDetails(null)}>
          <div className={`rounded-3xl w-full max-w-lg p-0 overflow-hidden shadow-2xl animate-in fade-in zoom-in-95 duration-200 ${theme === 'dark' ? 'bg-slate-900 border border-slate-800 text-white' : 'bg-[#FDFBF7] text-gray-900'}`} onClick={e => e.stopPropagation()}>
            <div className="bg-gray-900 p-7 flex justify-between items-start text-white relative overflow-hidden">
              <div className="absolute inset-0 bg-black/10"></div>
              <div className="relative z-10">
                <h2 className="text-3xl font-extrabold">{selectedTenantForDetails.name}</h2>
                <p className="text-gray-400 text-sm flex items-center gap-1.5 mt-2 font-medium"><Calendar size={14}/> Joined: {selectedTenantForDetails.dateEntered ? new Date(selectedTenantForDetails.dateEntered).toLocaleDateString() : 'Unknown Date'}</p>
              </div>
              <button onClick={() => setSelectedTenantForDetails(null)} className="text-gray-400 hover:text-white relative z-10 p-1 bg-white/10 rounded-full"><X size={20}/></button>
            </div>
            
            <div className="p-7 space-y-6">
              <div className="grid grid-cols-2 gap-4">
                <div className={`p-4 rounded-2xl border ${theme === 'dark' ? 'bg-slate-950 border-slate-800' : 'bg-[#F4EFE6] border-[#E8DFCE]'}`}>
                  <p className="text-[10px] text-gray-500 font-bold uppercase tracking-wider mb-1.5">Assigned House</p>
                  <p className={`font-bold flex items-center gap-2 ${theme === 'dark' ? 'text-white' : 'text-gray-900'}`}><Home size={16} className={`shrink-0 ${theme === 'dark' ? 'text-gray-400' : 'text-gray-800'}`}/>{houses.find(h => h.id === selectedTenantForDetails.houseId)?.name || 'Unassigned'}</p>
                </div>
                <div className={`p-4 rounded-2xl border ${theme === 'dark' ? 'bg-slate-950 border-slate-800' : 'bg-[#F4EFE6] border-[#E8DFCE]'}`}>
                  <p className="text-[10px] text-gray-500 font-bold uppercase tracking-wider mb-1.5">Contact Info</p>
                  <p className={`font-bold flex items-center gap-2 ${theme === 'dark' ? 'text-white' : 'text-gray-900'}`}><Phone size={16} className={`shrink-0 ${theme === 'dark' ? 'text-emerald-500' : 'text-emerald-600'}`}/>{selectedTenantForDetails.phone}</p>
                </div>
              </div>

              <div>
                <h4 className={`font-extrabold text-lg mb-3 border-b pb-3 ${theme === 'dark' ? 'border-slate-800' : 'border-[#DCD4C6]'}`}>Outstanding Balances</h4>
                <div className="flex gap-4">
                  <div className="flex-1">
                    <p className="text-xs text-gray-500 font-bold uppercase tracking-wider mb-1">Rent Arrears</p>
                    <p className={`font-mono text-xl font-black ${(selectedTenantForDetails.expectedRent || 0) - (selectedTenantForDetails.paidRent || 0) > 0 ? (theme === 'dark' ? 'text-rose-500' : 'text-rose-600') : (theme === 'dark' ? 'text-emerald-500' : 'text-emerald-600')}`}>{formatKes((selectedTenantForDetails.expectedRent || 0) - (selectedTenantForDetails.paidRent || 0))}</p>
                  </div>
                  <div className="flex-1">
                    <p className="text-xs text-gray-500 font-bold uppercase tracking-wider mb-1">Water Arrears</p>
                    <p className={`font-mono text-xl font-black ${(selectedTenantForDetails.expectedWater || 0) - (selectedTenantForDetails.paidWater || 0) > 0 ? (theme === 'dark' ? 'text-rose-500' : 'text-rose-600') : (theme === 'dark' ? 'text-emerald-500' : 'text-emerald-600')}`}>{formatKes((selectedTenantForDetails.expectedWater || 0) - (selectedTenantForDetails.paidWater || 0))}</p>
                  </div>
                </div>
              </div>

              {(() => {
                const tenantRepairs = repairs.filter(r => r.houseId === selectedTenantForDetails.houseId && r.status === 'OPEN');
                if (tenantRepairs.length > 0) {
                  return (
                    <div className={`p-5 rounded-2xl border ${theme === 'dark' ? 'bg-rose-500/10 border-rose-500/20' : 'bg-rose-500/10 border-rose-500/20'}`}>
                       <h4 className={`text-xs font-black uppercase tracking-wider flex items-center gap-1.5 mb-3 ${theme === 'dark' ? 'text-rose-500' : 'text-rose-600'}`}><Wrench size={14}/> Active Complaints</h4>
                       <ul className={`text-sm space-y-1.5 ml-5 list-disc font-medium ${theme === 'dark' ? 'text-rose-400' : 'text-rose-600'}`}>
                         {tenantRepairs.map(r => <li key={r.id}>{r.description}</li>)}
                       </ul>
                    </div>
                  );
                }
                return null;
              })()}

              <div className={`flex justify-between items-center pt-5 border-t ${theme === 'dark' ? 'border-slate-800' : 'border-[#DCD4C6]'}`}>
                {role === 'LANDLORD' && <button onClick={() => handleDeleteTenant(selectedTenantForDetails)} disabled={isProcessing} className={`text-sm font-bold px-4 py-2.5 rounded-xl transition disabled:opacity-50 ${theme === 'dark' ? 'text-rose-500 hover:bg-rose-500/10' : 'text-rose-600 hover:bg-rose-500/10'}`}>Remove Tenant</button>}
                {role === 'LANDLORD' ? (
                  <button onClick={() => setIsEditTenantModalOpen(true)} disabled={isProcessing} className="bg-gray-800 hover:bg-gray-900 text-white font-bold text-sm px-6 py-3 rounded-xl transition flex items-center gap-2 shadow-md hover:shadow-lg"><Edit size={16}/> Edit Details</button>
                ) : (
                  <p className="text-xs text-gray-500 flex items-center gap-1.5 ml-auto font-medium"><Info size={14}/> Editing locked for Managers</p>
                )}
              </div>
            </div>
          </div>
        </div>
      )}

      {isHistoryModalOpen && selectedTenant && (
        <div className="fixed inset-0 bg-black/60 flex items-center justify-center p-4 z-60 backdrop-blur-sm transition-opacity" onClick={() => closeAnyModal(setIsHistoryModalOpen)}>
          <div className={`rounded-3xl w-full max-w-3xl p-7 shadow-2xl animate-in fade-in zoom-in-95 duration-200 ${theme === 'dark' ? 'bg-slate-900 text-white border border-slate-800' : 'bg-[#FDFBF7] text-gray-900 border border-[#E8DFCE]'}`} onClick={e => e.stopPropagation()}>
            <div className={`flex justify-between items-center mb-6 border-b pb-4 ${theme === 'dark' ? 'border-slate-800' : 'border-[#DCD4C6]'}`}>
              <div>
                <h3 className="text-xl font-bold">Verified Payment Ledger</h3>
                <p className="text-xs text-gray-500 font-medium mt-1">Complete logs for: <strong className={`text-sm ml-1 ${theme === 'dark' ? 'text-white' : 'text-gray-900'}`}>{selectedTenant.name}</strong></p>
              </div>
              <button onClick={() => closeAnyModal(setIsHistoryModalOpen)} className={`p-2 rounded-full ${theme === 'dark' ? 'hover:bg-white/5 text-gray-400 hover:text-white' : 'hover:bg-black/5 text-gray-500 hover:text-gray-900'}`}><X size={20}/></button>
            </div>
            <div className="max-h-[60vh] overflow-y-auto space-y-3 pr-1">
              {tenantPaymentHistory.length === 0 ? (
                <p className={`text-sm font-medium py-10 text-center rounded-2xl ${theme === 'dark' ? 'bg-white/5 text-gray-400' : 'bg-black/5 text-gray-500'}`}>No confirmed payments exist for this tenant yet.</p>
              ) : (
                tenantPaymentHistory.map(p => (
                  <div key={p.id} className={`flex flex-col sm:flex-row sm:justify-between sm:items-center p-4 border rounded-2xl transition-all hover:shadow-md gap-4 ${theme === 'dark' ? 'bg-slate-950 border-slate-800' : 'bg-[#F4EFE6] border-[#DCD4C6]'}`}>
                    <div className="flex-1">
                      <p className={`font-bold text-base ${theme === 'dark' ? 'text-white' : 'text-gray-900'}`}>{p.type === 'COMBINED' ? 'Rent & Water' : p.type} Payment</p>
                      <p className="text-xs text-gray-500 font-semibold mt-1">Logged on: {new Date(p.date).toLocaleDateString()} | Method: {p.method}</p>
                      {p.messageCode && <p className={`text-[10px] font-mono font-bold px-2 py-1 rounded-md inline-block mt-2 border ${theme === 'dark' ? 'bg-white/5 text-gray-300 border-white/10' : 'bg-black/5 text-gray-700 border-black/10'}`}>CODE: {p.messageCode}</p>}
                    </div>
                    <div className="text-left sm:text-right">
                      <p className={`font-black text-lg font-mono ${theme === 'dark' ? 'text-white' : 'text-gray-900'}`}>{formatKes(p.amount)}</p>
                      {p.excessAmount && <p className={`text-[10px] font-bold mt-1.5 uppercase tracking-wider ${theme === 'dark' ? 'text-gray-400' : 'text-gray-600'}`}>Excess: {formatKes(p.excessAmount)}</p>}
                    </div>
                    <div>
                      {/* NEW RECEIPT DOWNLOAD BUTTON */}
                      <button 
                        onClick={() => printReceipt(p, selectedTenant)}
                        className={`mt-2 sm:mt-0 w-full sm:w-auto flex items-center justify-center gap-1.5 px-4 py-2 text-xs font-bold rounded-xl transition ${theme === 'dark' ? 'bg-emerald-600/20 text-emerald-400 hover:bg-emerald-600/40' : 'bg-emerald-100 text-emerald-700 hover:bg-emerald-200'}`}
                      >
                        <Download size={14}/> Download Receipt
                      </button>
                    </div>
                  </div>
                ))
              )}
            </div>
          </div>
        </div>
      )}

    </div>
  );
}
