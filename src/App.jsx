import { useState, useEffect, useMemo, useRef, useCallback } from 'react';
import { Capacitor } from '@capacitor/core';
import { FirebaseAuthentication } from '@capacitor-firebase/authentication';
import { App as CapacitorApp } from '@capacitor/app';
import { BiometricAuth } from '@aparajita/capacitor-biometric-auth';
import { Preferences } from '@capacitor/preferences';
import { 
  Users, Home, Wallet, Wrench, LayoutDashboard, LogOut, Trash2,
  CheckCircle2, Plus, AlertCircle, Phone, X, ShieldCheck,
  Check, Clock, FileText, Calendar, Edit, Info, Coins, ListOrdered,
  Droplet, Truck, Sun, Moon, BellRing, Menu,
  Eye, EyeOff, Download, Search, ReceiptText, FileBarChart, Fingerprint,
  Settings, Bell, Building2, Activity,
  SlidersHorizontal, Database, ArrowUpRight, ArrowLeft, RotateCcw
} from 'lucide-react';
import { allocatePayment, parseMoney } from './lib/money.js';
import { canAccessWorkspaceRecord, hasPermission, normalizeRole, PERMISSIONS, ROLES } from './lib/permissions.js';
import { APP_IDLE_TIMEOUT_MS, formatLockoutDuration, getCurrentTimestamp, getNextPasswordFailure, getRemainingLockoutSeconds } from './lib/authSecurity.js';
import { firebaseClientConfig } from './lib/firebaseClientConfig.js';

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
  signInWithPopup,
  signInWithCredential,
  initializeAuth,
  indexedDBLocalPersistence
} from 'firebase/auth';
import { 
  initializeFirestore,
  persistentLocalCache,
  persistentMultipleTabManager,
  collection, 
  getDocs,
  onSnapshot, 
  doc, 
  addDoc, 
  updateDoc, 
  getDoc,
  runTransaction,
  query,
  where,
  writeBatch
} from 'firebase/firestore';

const PORTFOLIO_URL = 'https://gikunjucreates.work.gd/';
const handlePortfolioLinkClick = event => {
  event.preventDefault();
  if (Capacitor.isNativePlatform()) {
    window.location.assign(PORTFOLIO_URL);
    return;
  }
  window.open(PORTFOLIO_URL, '_blank', 'noopener,noreferrer');
};
const PortfolioLink = ({ theme, children }) => (
  <a
    href={PORTFOLIO_URL}
    target="_blank"
    rel="noopener noreferrer"
    onClick={handlePortfolioLinkClick}
    className={`text-sm font-semibold underline decoration-1 underline-offset-4 transition-colors focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 ${theme === 'dark' ? 'text-slate-200 decoration-slate-500 hover:text-white focus-visible:outline-slate-200' : 'text-[#34483b] decoration-[#849286] hover:text-[#17261d] focus-visible:outline-[#34483b]'}`}
  >
    {children}
  </a>
);

// --- FIREBASE SETUP ---
const firebaseConfig = {
  apiKey: import.meta.env.VITE_FIREBASE_API_KEY || firebaseClientConfig.apiKey,
  authDomain: import.meta.env.VITE_FIREBASE_AUTH_DOMAIN || firebaseClientConfig.authDomain,
  projectId: import.meta.env.VITE_FIREBASE_PROJECT_ID || firebaseClientConfig.projectId,
  storageBucket: import.meta.env.VITE_FIREBASE_STORAGE_BUCKET || firebaseClientConfig.storageBucket,
  messagingSenderId: import.meta.env.VITE_FIREBASE_MESSAGING_SENDER_ID || firebaseClientConfig.messagingSenderId,
  appId: import.meta.env.VITE_FIREBASE_APP_ID || firebaseClientConfig.appId
};

const isFirebaseConfigured = Object.values(firebaseConfig).every(Boolean);
const useLegacyAndroidGoogleAuth = import.meta.env.VITE_ANDROID_LEGACY_GOOGLE_AUTH === 'true';
const app = isFirebaseConfigured ? (getApps().length === 0 ? initializeApp(firebaseConfig) : getApp()) : null;
const auth = app ? (Capacitor.isNativePlatform()
  ? initializeAuth(app, { persistence: indexedDBLocalPersistence })
  : getAuth(app)) : null;
const db = app ? initializeFirestore(app, {
  localCache: persistentLocalCache({ tabManager: persistentMultipleTabManager() })
}) : null;
const appId = firebaseConfig.projectId || 'house-management-portal';
const DEFAULT_CURRENCY = import.meta.env.VITE_DEFAULT_CURRENCY || 'KES';
const DEFAULT_TIMEZONE = import.meta.env.VITE_DEFAULT_TIMEZONE || 'Africa/Nairobi';
const DEFAULT_WORKSPACE_ID = import.meta.env.VITE_DEFAULT_WORKSPACE_ID || 'main-workspace';
const compareNatural = (left, right) => String(left || '').localeCompare(String(right || ''), undefined, { numeric: true, sensitivity: 'base' });
const DATA_COLLECTION_LABELS = {
  houses: 'houses', tenants: 'tenants', payments: 'payments', repairs: 'maintenance',
  septicLogs: 'septic logs', garbageLogs: 'garbage collection logs', masterWaterBills: 'water bills', waterVaultResets: 'water vault',
  expenses: 'expenses', auditLogs: 'activity history', notifications: 'notifications',
  billingCycles: 'billing cycles', tenantCycles: 'tenant billing records',
  tenantChangeRequests: 'tenant approval requests',
};
const sortByDateDescending = (records, field = 'date') => (
  [...records].sort((left, right) => new Date(right[field] || 0) - new Date(left[field] || 0))
);
const describeSnapshotError = (error, collectionName) => {
  if (error?.code === 'permission-denied') return `Access to ${DATA_COLLECTION_LABELS[collectionName] || collectionName} was denied by Firebase rules.`;
  if (error?.code === 'unavailable') return `${DATA_COLLECTION_LABELS[collectionName] || collectionName} are temporarily unavailable. Check your connection.`;
  return `${DATA_COLLECTION_LABELS[collectionName] || collectionName} could not be synchronized.`;
};

// Temporary compatibility bridge for the existing live accounts. Create users/{uid}
// profiles and remove this bridge after the migration is complete.
const LEGACY_ROLE_BY_UID = {
  [import.meta.env.VITE_LEGACY_LANDLORD_UID || 'b4HMBcL0WXT3Qg2vunj5ITZOVb72']: ROLES.LANDLORD,
  [import.meta.env.VITE_LEGACY_MANAGER_UID_1 || 'CG6wl2NaTcdLHyGlXHk4w9eCU653']: ROLES.MANAGER,
  [import.meta.env.VITE_LEGACY_MANAGER_UID_2 || 'N8wEpIJvUZRmD6WoYYxqpUiiLhj2']: ROLES.MANAGER,
};

const collectionRef = (collectionName) => collection(db, 'artifacts', appId, 'public', 'data', collectionName);
const documentRef = (collectionName, documentId) => doc(db, 'artifacts', appId, 'public', 'data', collectionName, documentId);
const tenantCycleDocumentId = (tenantId, cycleId) => `${tenantId}_${cycleId}`;
const monthNames = Array.from({ length: 12 }, (_, index) => new Date(2026, index, 1).toLocaleString('en', { month: 'long' }));

const getCycleTenantStatus = (cycleTenant) => {
  const rentDue = Number(cycleTenant.expectedRent || 0) - Number(cycleTenant.paidRent || 0);
  const waterDue = Number(cycleTenant.expectedWater || 0) - Number(cycleTenant.paidWater || 0);
  if (rentDue <= 0 && waterDue <= 0) return 'CLEARED';
  if (Number(cycleTenant.paidRent || 0) > 0 || Number(cycleTenant.paidWater || 0) > 0) return 'ARREARS';
  return 'OPEN';
};

const finalizeTenantCycle = (cycleTenant) => ({
  ...cycleTenant,
  status: getCycleTenantStatus(cycleTenant) === 'CLEARED' ? 'CLEARED' : 'ARREARS'
});

const commitBatches = async (operations, chunkSize = 450) => {
  for (let index = 0; index < operations.length; index += chunkSize) {
    const batch = writeBatch(db);
    operations.slice(index, index + chunkSize).forEach((operation) => operation(batch));
    await promiseTimeout(batch.commit(), 15000);
  }
};

const getMonthKey = (dateValue) => {
  const date = new Date(dateValue);
  if (Number.isNaN(date.getTime())) return '';
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}`;
};

const getMonthLabel = (key) => {
  const [year, month] = key.split('-').map(Number);
  return new Date(year, month - 1, 1).toLocaleString('en-KE', { month: 'long', year: 'numeric' });
};

const createCycleLabel = (year, monthIndex) => new Date(year, monthIndex, 1).toLocaleString('en-KE', {
  month: 'long',
  year: 'numeric'
});

const createCurrentMonthKey = () => getMonthKey(new Date());
const getPreviousMonthParts = (date = new Date()) => {
  const previous = new Date(date.getFullYear(), date.getMonth() - 1, 1);
  return { month: previous.getMonth(), year: previous.getFullYear() };
};

const promiseTimeout = (promise, ms = 15000) => {
  return Promise.race([
    promise,
    new Promise((_, reject) => setTimeout(() => reject(new Error("Database operation timed out. Please check your network connection.")), ms))
  ]);
};

const describeActionError = (error, action) => {
  const isPermissionDenied = error?.code === 'permission-denied' ||
    /missing or insufficient permissions/i.test(error?.message || '');
  if (isPermissionDenied) {
    const stage = error?.resetStage ? ` while ${error.resetStage}` : '';
    const partialWarning = error?.partialReset
      ? ' Earlier reset batches may already have completed; check the records before retrying.'
      : '';
    return `Firebase denied permission${stage} for ${action}. Check that you are signed in with the correct role and workspace, and that the latest Firestore rules are deployed.${partialWarning}`;
  }
  if (error?.resetStage) {
    return `The reset may be partially complete. It stopped while ${error.resetStage}: ${error.message || 'unknown error'}`;
  }
  return error?.message || `Could not complete ${action}.`;
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
  const [isAppLocked, setIsAppLocked] = useState(false);
  const [biometricLabel, setBiometricLabel] = useState('biometric');
  const [biometricError, setBiometricError] = useState('');
  const [loginSecurity, setLoginSecurity] = useState({ failedAttempts: 0, lockedUntil: 0 });
  const [lockoutClock, setLockoutClock] = useState(0);
  const [role, setRole] = useState(null);
  const [userProfile, setUserProfile] = useState(null);
  const [billingCycles, setBillingCycles] = useState([]);
  const [tenantCycles, setTenantCycles] = useState([]);
  const [activeTab, setActiveTab] = useState('dashboard');
  useEffect(() => {
    if (!Capacitor.isNativePlatform() || activeTab !== 'billing') return undefined;
    let registration;
    let disposed = false;
    CapacitorApp.addListener('backButton', () => {
      if (document.querySelector('[aria-modal="true"]')) return;
      setActiveTab('dashboard');
    }).then(listener => {
      if (disposed) void listener.remove();
      else registration = listener;
    });
    return () => {
      disposed = true;
      if (registration) void registration.remove();
    };
  }, [activeTab]);
  const [loading, setLoading] = useState(() => Boolean(auth));
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const [globalSearch, setGlobalSearch] = useState('');
  const [toastMessage, setToastMessage] = useState('');
  // Global states for errors and visual loading states
  const [isProcessing, setIsProcessing] = useState(false);
  const [modalError, setModalError] = useState('');
  const [syncIssues, setSyncIssues] = useState([]);
  const [confirmationAction, setConfirmationAction] = useState(null);
  const [isCycleModalOpen, setIsCycleModalOpen] = useState(false);
  const [isBackfillCycleModalOpen, setIsBackfillCycleModalOpen] = useState(false);
  const [isCycleChargeModalOpen, setIsCycleChargeModalOpen] = useState(false);
  const [cycleMonth, setCycleMonth] = useState(() => new Date().getMonth());
  const [cycleYear, setCycleYear] = useState(() => new Date().getFullYear());
  const [backfillCycleMonth, setBackfillCycleMonth] = useState(() => getPreviousMonthParts().month);
  const [backfillCycleYear, setBackfillCycleYear] = useState(() => getPreviousMonthParts().year);
  const [selectedDashboardCycleId, setSelectedDashboardCycleId] = useState('ACTIVE');
  const [selectedPaymentCycleId, setSelectedPaymentCycleId] = useState('');
  const [tenantSearch, setTenantSearch] = useState('');
  const [tenantStatusFilter, setTenantStatusFilter] = useState('ALL');
  const [paymentMonthFilter, setPaymentMonthFilter] = useState(createCurrentMonthKey);
  const rejectedGoogleUserUid = useRef(null);
  const biometricInfoRef = useRef(null);
  const biometricPromptInProgress = useRef(false);
  const skipBiometricGateRef = useRef(false);

  // Authentication State Variables
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [loginError, setLoginError] = useState(() => auth ? '' : 'Firebase is not configured for this app.');
  const [showWelcomeScreen, setShowWelcomeScreen] = useState(false);

  // Live Database States
  const [houses, setHouses] = useState([]);
  const [tenants, setTenants] = useState([]);
  const [payments, setPayments] = useState([]);
  const [repairs, setRepairs] = useState([]);
  const [septicLogs, setSepticLogs] = useState([]);
  const [garbageLogs, setGarbageLogs] = useState([]);
  const [masterWaterBills, setMasterWaterBills] = useState([]);
  const [waterVaultResets, setWaterVaultResets] = useState([]);
  const [expenses, setExpenses] = useState([]);
  const [activityLogs, setActivityLogs] = useState([]);
  const [notifications, setNotifications] = useState([]);
  const [tenantChangeRequests, setTenantChangeRequests] = useState([]);

  const isLandlord = hasPermission(role, PERMISSIONS.MANAGE_SETTINGS);
  const canManageProperties = hasPermission(role, PERMISSIONS.MANAGE_PROPERTIES);
  const canManageTenants = hasPermission(role, PERMISSIONS.MANAGE_TENANTS);
  const canRecordRent = hasPermission(role, PERMISSIONS.RECORD_RENT);
  const canRecordWater = hasPermission(role, PERMISSIONS.RECORD_WATER);
  const canApproveRent = hasPermission(role, PERMISSIONS.APPROVE_RENT);
  const loginLockoutSeconds = getRemainingLockoutSeconds(loginSecurity.lockedUntil, lockoutClock);
  const loginFeedback = loginLockoutSeconds > 0
    ? `Too many incorrect passwords. Try again in ${formatLockoutDuration(loginLockoutSeconds)}.`
    : loginError;

  // Modals Visibility Controllers
  const [isHouseModalOpen, setIsHouseModalOpen] = useState(false);
  const [selectedHouseForEdit, setSelectedHouseForEdit] = useState(null);
  const [isTenantModalOpen, setIsTenantModalOpen] = useState(false);
  const [isPaymentModalOpen, setIsPaymentModalOpen] = useState(false);
  const [isRepairModalOpen, setIsRepairModalOpen] = useState(false);
  const [isBillingModalOpen, setIsBillingModalOpen] = useState(false);
  const [isResolveRepairModalOpen, setIsResolveRepairModalOpen] = useState(false);
  const [isHistoryModalOpen, setIsHistoryModalOpen] = useState(false);
  const [isSepticModalOpen, setIsSepticModalOpen] = useState(false);
  const [isGarbageModalOpen, setIsGarbageModalOpen] = useState(false);
  const [isWaterBillModalOpen, setIsWaterBillModalOpen] = useState(false);
  const [isEditTenantModalOpen, setIsEditTenantModalOpen] = useState(false);
  const [isExpenseModalOpen, setIsExpenseModalOpen] = useState(false);
  const [newTenantHouseId, setNewTenantHouseId] = useState('');
  const [editTenantHouseId, setEditTenantHouseId] = useState('');
  
  // Selection Targets
  const [selectedTenant, setSelectedTenant] = useState(null); 
  const [selectedTenantCycleForEdit, setSelectedTenantCycleForEdit] = useState(null);
  const [selectedTenantForDetails, setSelectedTenantForDetails] = useState(null); 
  const [selectedRepair, setSelectedRepair] = useState(null); 
  // The three existing production accounts belong to the original single
  // workspace. Keep their scope stable even if an old users/{uid} profile has
  // a stale or incompatible workspaceId value.
  const workspaceId = LEGACY_ROLE_BY_UID[user?.uid] ? DEFAULT_WORKSPACE_ID : userProfile?.workspaceId || user?.uid || '';
  const makeRecordMetadata = (actor, isUpdate = false) => ({
    workspaceId,
    [isUpdate ? 'updatedBy' : 'createdBy']: actor?.uid || ''
  });
  const clearWorkspaceData = useCallback(() => {
    setHouses([]);
    setTenants([]);
    setPayments([]);
    setRepairs([]);
    setSepticLogs([]);
    setGarbageLogs([]);
    setMasterWaterBills([]);
    setWaterVaultResets([]);
    setExpenses([]);
    setActivityLogs([]);
    setNotifications([]);
    setTenantChangeRequests([]);
    setBillingCycles([]);
    setTenantCycles([]);
    setSyncIssues([]);
  }, []);

  const loadLoginSecurityState = useCallback(async () => {
    try {
      const { value } = await Preferences.get({ key: 'ruiru_login_security' });
      const saved = value ? JSON.parse(value) : {};
      return {
        failedAttempts: Math.max(0, Math.floor(Number(saved.failedAttempts) || 0)),
        lockedUntil: Math.max(0, Number(saved.lockedUntil) || 0),
      };
    } catch {
      return { failedAttempts: 0, lockedUntil: 0 };
    }
  }, []);

  const saveLoginSecurityState = useCallback(async (nextState) => {
    try {
      await Preferences.set({ key: 'ruiru_login_security', value: JSON.stringify(nextState) });
    } catch {
      // Keep the current process protected if native storage is temporarily unavailable.
    }
    setLoginSecurity(nextState);
    setLockoutClock(getCurrentTimestamp());
  }, []);

  const clearLoginSecurityState = useCallback(async () => {
    try {
      await Preferences.remove({ key: 'ruiru_login_security' });
    } catch {
      // A successful sign-in still clears the in-memory counter.
    }
    setLoginSecurity({ failedAttempts: 0, lockedUntil: 0 });
    setLockoutClock(getCurrentTimestamp());
  }, []);

  const refreshDeviceBiometrics = useCallback(async () => {
    if (!Capacitor.isNativePlatform()) return null;
    try {
      const info = await BiometricAuth.checkBiometry();
      biometricInfoRef.current = info;
      const types = (info.biometryTypes || []).map(type => String(type).toLowerCase());
      const primaryType = String(info.biometryType || '').toLowerCase();
      setBiometricLabel(types.includes('fingerprintauthentication') || primaryType.includes('fingerprint') ? 'fingerprint' : 'biometric');
      return info;
    } catch {
      biometricInfoRef.current = null;
      return null;
    }
  }, []);

  const requestBiometricUnlock = useCallback(async () => {
    if (!Capacitor.isNativePlatform() || !biometricInfoRef.current?.isAvailable || biometricPromptInProgress.current) return false;
    biometricPromptInProgress.current = true;
    setBiometricError('');
    try {
      await BiometricAuth.authenticate({
        reason: 'Unlock Ruiru Rentals',
        cancelTitle: 'Cancel',
        allowDeviceCredential: false,
        androidTitle: 'Unlock Ruiru Rentals',
        androidSubtitle: 'Verify with your fingerprint',
        androidConfirmationRequired: false,
      });
      await Preferences.remove({ key: 'ruiru_last_background_at' }).catch(() => {});
      setIsAppLocked(false);
      return true;
    } catch (error) {
      if (!['userCancel', 'appCancel', 'systemCancel'].includes(error?.code)) {
        setBiometricError('Fingerprint was not recognized. Try again or sign in with your password.');
      }
      return false;
    } finally {
      biometricPromptInProgress.current = false;
    }
  }, []);

  useEffect(() => {
    localStorage.setItem('ruiru_theme', theme);
    document.documentElement.dataset.theme = theme;
  }, [theme]);

  useEffect(() => {
    if (!toastMessage) return undefined;
    const timer = setTimeout(() => setToastMessage(''), 4000);
    return () => clearTimeout(timer);
  }, [toastMessage]);

  useEffect(() => {
    let disposed = false;
    void loadLoginSecurityState().then(saved => {
      if (!disposed) {
        setLoginSecurity(saved);
        setLockoutClock(getCurrentTimestamp());
      }
    });
    return () => { disposed = true; };
  }, [loadLoginSecurityState]);

  useEffect(() => {
    if (!loginSecurity.lockedUntil || loginSecurity.lockedUntil <= getCurrentTimestamp()) return undefined;
    const timer = window.setInterval(() => {
      const now = getCurrentTimestamp();
      setLockoutClock(now);
      if (loginSecurity.lockedUntil <= now) {
        setLoginSecurity(current => ({ ...current, lockedUntil: 0 }));
        setLoginError('');
      }
    }, 1000);
    return () => window.clearInterval(timer);
  }, [loginSecurity.lockedUntil]);

  useEffect(() => {
    if (!Capacitor.isNativePlatform() || !auth) return undefined;
    let registration;
    let disposed = false;

    const handleAppStateChange = async ({ isActive }) => {
      if (!auth.currentUser) return;
      if (!isActive) {
        try {
          await Preferences.set({ key: 'ruiru_last_background_at', value: String(getCurrentTimestamp()) });
        } catch {
          // Session checks still run for the current process.
        }
        if (biometricInfoRef.current?.isAvailable) setIsAppLocked(true);
        return;
      }

      const biometricInfo = biometricInfoRef.current || await refreshDeviceBiometrics();
      if (biometricInfo?.isAvailable) {
        setIsAppLocked(true);
        void requestBiometricUnlock();
        return;
      }

      const lastBackgroundAt = await Preferences.get({ key: 'ruiru_last_background_at' })
        .then(({ value }) => Number(value) || 0)
        .catch(() => 0);
      if (lastBackgroundAt && getCurrentTimestamp() - lastBackgroundAt >= APP_IDLE_TIMEOUT_MS) {
        setLoginError('Your session expired after 15 minutes away. Sign in again.');
        setIsAppLocked(false);
        await signOut(auth);
      } else {
        await Preferences.remove({ key: 'ruiru_last_background_at' }).catch(() => {});
      }
    };

    const startListener = async () => {
      try {
        await refreshDeviceBiometrics();
        const listener = await CapacitorApp.addListener('appStateChange', handleAppStateChange);
        if (disposed) await listener.remove();
        else registration = listener;
      } catch {
        biometricInfoRef.current = null;
      }
    };
    void startListener();
    return () => {
      disposed = true;
      if (registration) void registration.remove();
    };
  }, [refreshDeviceBiometrics, requestBiometricUnlock]);

  // Authentication is intentionally role-agnostic in the client. The role is resolved
  // from a protected profile/custom claim instead of a hard-coded email allowlist.
  useEffect(() => {
    if (!auth) {
      return undefined;
    }

    let authResolved = false;
    const authTimeout = setTimeout(() => {
      if (!authResolved) {
        setLoading(false);
        setLoginError(current => current || 'Firebase is taking too long to respond. Check your connection and try again.');
      }
    }, 10000);

    const unsubscribe = onAuthStateChanged(auth, async (currentUser) => {
      authResolved = true;
      if (currentUser) {
        if (rejectedGoogleUserUid.current === currentUser.uid) {
          setLoading(false);
          return;
        }
        try {
          let shouldPromptBiometric = false;
          if (Capacitor.isNativePlatform()) {
            const freshPasswordOrGoogleSignIn = skipBiometricGateRef.current;
            skipBiometricGateRef.current = false;
            const biometricInfo = await refreshDeviceBiometrics();
            if (biometricInfo?.isAvailable) {
              setIsAppLocked(!freshPasswordOrGoogleSignIn);
              shouldPromptBiometric = !freshPasswordOrGoogleSignIn;
            } else if (!freshPasswordOrGoogleSignIn) {
              const lastBackgroundAt = await Preferences.get({ key: 'ruiru_last_background_at' })
                .then(({ value }) => Number(value) || 0)
                .catch(() => 0);
              if (lastBackgroundAt && getCurrentTimestamp() - lastBackgroundAt >= APP_IDLE_TIMEOUT_MS) {
                setLoginError('Your session expired after 15 minutes away. Sign in again.');
                await Preferences.remove({ key: 'ruiru_last_background_at' }).catch(() => {});
                await signOut(auth);
                setLoading(false);
                return;
              }
              setIsAppLocked(false);
              await Preferences.remove({ key: 'ruiru_last_background_at' }).catch(() => {});
            } else {
              setIsAppLocked(false);
              await Preferences.remove({ key: 'ruiru_last_background_at' }).catch(() => {});
            }
          }
          const token = await getIdTokenResult(currentUser);
          const profileSnapshot = db ? await getDoc(doc(db, 'users', currentUser.uid)) : null;
          const profile = profileSnapshot?.exists() ? profileSnapshot.data() : {};
          const resolvedRole = normalizeRole(token.claims.role || profile.role || LEGACY_ROLE_BY_UID[currentUser.uid]);

          if (!resolvedRole) throw new Error('Account permissions could not be verified.');

          setUser(currentUser);
          setUserProfile({
            ...profile,
            uid: currentUser.uid,
            workspaceId: LEGACY_ROLE_BY_UID[currentUser.uid] ? DEFAULT_WORKSPACE_ID : profile.workspaceId,
          });
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
          if (shouldPromptBiometric) void requestBiometricUnlock();
        } catch {
          setLoginError('Your Firebase account was found, but it has no verified portal role. Create a users/{UID} profile with role LANDLORD or MANAGER, then sign in again.');
          await signOut(auth);
          setUser(null);
          setRole(null);
          setUserProfile(null);
          clearWorkspaceData();
          setLoading(false);
        }
      } else {
        skipBiometricGateRef.current = false;
        setIsAppLocked(false);
        setBiometricError('');
        setUser(null);
        setRole(null);
        setUserProfile(null);
        clearWorkspaceData();
        setLoading(false);
      }
    });
    return () => {
      clearTimeout(authTimeout);
      unsubscribe();
    };
  }, [refreshDeviceBiometrics, requestBiometricUnlock, clearWorkspaceData]);

  useEffect(() => {
    if (!user || !db) return undefined;

    const getColRef = (colName) => {
      const ref = collection(db, 'artifacts', appId, 'public', 'data', colName);
      const isLegacyAccount = Boolean(LEGACY_ROLE_BY_UID[user?.uid]);
      const needsWorkspaceQuery = [ROLES.LANDLORD, ROLES.MANAGER].includes(role) && !isLegacyAccount;
      return needsWorkspaceQuery ? query(ref, where('workspaceId', '==', workspaceId)) : ref;
    };

    const subscriptions = [];
    const subscribe = (collectionName, setter, sortField, transform = records => records) => {
      const unsubscribe = onSnapshot(getColRef(collectionName), (snap) => {
        const records = snap.docs.map(snapshot => ({ id: snapshot.id, ...snapshot.data() }));
        setter(transform(sortField ? sortByDateDescending(records, sortField) : records));
        setSyncIssues(current => current.filter(issue => issue.collectionName !== collectionName));
      }, (error) => {
        setSyncIssues(current => [
          ...current.filter(issue => issue.collectionName !== collectionName),
          { collectionName, message: describeSnapshotError(error, collectionName) },
        ]);
      });
      subscriptions.push(unsubscribe);
    };

    subscribe('houses', setHouses, null, records => records.sort((left, right) => compareNatural(left.name, right.name)));
    subscribe('tenants', setTenants);
    subscribe('payments', setPayments, 'date');
    subscribe('repairs', setRepairs, 'date');
    subscribe('septicLogs', setSepticLogs, 'date');
    subscribe('garbageLogs', setGarbageLogs, 'date');
    subscribe('masterWaterBills', setMasterWaterBills, 'date');
    if (role === ROLES.LANDLORD) subscribe('waterVaultResets', setWaterVaultResets, 'date');
    subscribe('expenses', setExpenses, 'date');
    if (role === ROLES.LANDLORD) subscribe('auditLogs', setActivityLogs, 'timestamp');
    subscribe('notifications', setNotifications, 'createdAt');
    subscribe('tenantChangeRequests', setTenantChangeRequests, 'requestedAt');
    subscribe('billingCycles', setBillingCycles, null, records => records.sort((left, right) => new Date(right.openedAt || 0) - new Date(left.openedAt || 0)));
    subscribe('tenantCycles', setTenantCycles);

    return () => subscriptions.forEach(unsubscribe => unsubscribe());
  }, [user, role, workspaceId]);

  const activeCycle = useMemo(() => billingCycles.find(cycle => cycle.status === 'OPEN') || null, [billingCycles]);
  const selectedPaymentCycle = billingCycles.find(cycle => cycle.id === selectedPaymentCycleId) || activeCycle;
  const selectedPaymentTenantCycle = selectedTenant && selectedPaymentCycle
    ? tenantCycles.find(cycle => cycle.tenantId === selectedTenant.id && cycle.cycleId === selectedPaymentCycle.id) || null
    : null;
  const viewedCycle = selectedDashboardCycleId === 'ACTIVE'
    ? activeCycle
    : billingCycles.find(cycle => cycle.id === selectedDashboardCycleId) || activeCycle;
  const isHistoricalCycleView = Boolean(viewedCycle && viewedCycle.id !== activeCycle?.id);
  const viewedCycleTenantCycles = useMemo(() => tenantCycles
    .filter(cycle => cycle.cycleId === viewedCycle?.id)
    .sort((left, right) => compareNatural(left.tenantName, right.tenantName)), [tenantCycles, viewedCycle]);
  const activeTenants = useMemo(() => tenants.filter(t => t.status !== 'ARCHIVED' && !t.archivedAt), [tenants]);
  const visibleTenantChangeRequests = useMemo(() => tenantChangeRequests
    .filter(request => isLandlord ? request.status === 'PENDING' : request.createdBy === user?.uid)
    .sort((left, right) => new Date(right.requestedAt || 0) - new Date(left.requestedAt || 0)),
  [tenantChangeRequests, isLandlord, user]);
  const pendingTenantCreationHouseIds = useMemo(() => new Set(tenantChangeRequests
    .filter(request => request.action === 'CREATE_TENANT' && request.status === 'PENDING')
    .map(request => request.houseId)), [tenantChangeRequests]);
  const activeTenantCycles = useMemo(() => new Map(
    tenantCycles.filter(cycle => cycle.cycleId === activeCycle?.id).map(cycle => [cycle.tenantId, cycle])
  ), [tenantCycles, activeCycle]);
  const selectedTenantCycle = selectedTenant ? activeTenantCycles.get(selectedTenant.id) : null;
  const selectedDetailCycle = selectedTenantForDetails ? activeTenantCycles.get(selectedTenantForDetails.id) : null;
  const selectedDetailHouse = selectedTenantForDetails
    ? houses.find(house => house.id === selectedTenantForDetails.houseId)
    : null;
  const selectedDetailRent = Number(selectedDetailHouse?.rent ?? selectedTenantForDetails?.expectedRent ?? 0);
  const selectedDetailDeposit = selectedDetailRent;
  const selectedDetailRentDue = selectedDetailCycle
    ? Number(selectedDetailCycle.expectedRent || 0) - Number(selectedDetailCycle.paidRent || 0)
    : Number(selectedTenantForDetails?.expectedRent || 0) - Number(selectedTenantForDetails?.paidRent || 0);
  const selectedDetailWaterDue = selectedDetailCycle
    ? Number(selectedDetailCycle.expectedWater || 0) - Number(selectedDetailCycle.paidWater || 0)
    : Number(selectedTenantForDetails?.expectedWater || 0) - Number(selectedTenantForDetails?.paidWater || 0);
  const selectedNewTenantHouse = houses.find(house => house.id === newTenantHouseId);
  const selectedEditTenantHouse = houses.find(house => house.id === editTenantHouseId);
  const ledgerMonths = useMemo(() => {
    const monthKeys = [...new Set(payments.map(payment => getMonthKey(payment.date)).filter(Boolean))];
    return monthKeys.sort((a, b) => b.localeCompare(a));
  }, [payments]);

  const filteredBillingTenants = useMemo(() => {
    const normalizedSearch = tenantSearch.trim().toLowerCase();
    return activeTenants.filter(tenant => {
      const cycle = activeTenantCycles.get(tenant.id);
      const rentDue = Number(cycle?.expectedRent || 0) - Number(cycle?.paidRent || 0);
      const waterDue = Number(cycle?.expectedWater || 0) - Number(cycle?.paidWater || 0);
      const hasArrears = Boolean(cycle) && (rentDue > 0 || waterDue > 0);
      const isCleared = Boolean(cycle) && rentDue <= 0 && waterDue <= 0;
      const matchesSearch = !normalizedSearch || tenant.name?.toLowerCase().includes(normalizedSearch);
      const matchesStatus = tenantStatusFilter === 'ALL'
        || (tenantStatusFilter === 'ARREARS' && hasArrears)
        || (tenantStatusFilter === 'CLEARED' && isCleared);
      return matchesSearch && matchesStatus;
    });
  }, [activeTenants, activeTenantCycles, tenantSearch, tenantStatusFilter]);

  // Derived occupancies
  const occupiedHouseIds = useMemo(() => {
    return new Set(activeTenants.map(t => t.houseId).filter(Boolean));
  }, [activeTenants]);

  const recordDefaults = () => ({ workspaceId, createdBy: user?.uid || '', updatedBy: user?.uid || '' });

  const recordAudit = async (action, entity, entityId, metadata = {}) => {
    if (!db || !user) return;
    try {
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
    } catch {
      // Audit availability must never make the underlying user action appear
      // to fail, especially during logout or legacy-record migration.
    }
  };

  // Handle standard email password sign in
  const handleLoginSubmit = async (e) => {
    e.preventDefault();
    if (isProcessing) return;
    setLoginError('');
    if (!auth) {
      setLoginError('Firebase is not configured for this app.');
      return;
    }
    setIsProcessing(true);
    let knownFailures = loginSecurity.failedAttempts;
    try {
      const savedSecurity = await loadLoginSecurityState();
      knownFailures = Math.max(knownFailures, savedSecurity.failedAttempts);
      const activeSecurity = {
        failedAttempts: knownFailures,
        lockedUntil: Math.max(loginSecurity.lockedUntil, savedSecurity.lockedUntil),
      };
      setLoginSecurity(activeSecurity);
      const now = getCurrentTimestamp();
      setLockoutClock(now);
      if (activeSecurity.lockedUntil > now) {
        setLoginError(`Too many incorrect passwords. Try again in ${formatLockoutDuration(getRemainingLockoutSeconds(activeSecurity.lockedUntil))}.`);
        return;
      }
      rejectedGoogleUserUid.current = null;
      if (Capacitor.isNativePlatform()) skipBiometricGateRef.current = true;
      await signInWithEmailAndPassword(auth, email.trim(), password);
      await clearLoginSecurityState();
      triggerWelcome();
    } catch (error) {
      skipBiometricGateRef.current = false;
      if (['auth/invalid-credential', 'auth/wrong-password', 'auth/user-not-found', 'auth/invalid-login-credentials'].includes(error?.code)) {
        const savedSecurity = await loadLoginSecurityState();
        const nextSecurity = getNextPasswordFailure(Math.max(knownFailures, savedSecurity.failedAttempts));
        await saveLoginSecurityState(nextSecurity);
        const now = getCurrentTimestamp();
        setLoginError(nextSecurity.lockedUntil > now ? `Too many incorrect passwords. Try again in ${formatLockoutDuration(getRemainingLockoutSeconds(nextSecurity.lockedUntil, now))}.` : 'Invalid credentials.');
      } else if (error?.code === 'auth/too-many-requests') {
        setLoginError('Firebase is temporarily limiting sign-in attempts. Wait a little, then try again.');
      } else {
        setLoginError(error?.message?.replace(/^Firebase:\s*/i, '') || 'Unable to sign in. Check your connection and try again.');
      }
    } finally {
      setIsProcessing(false);
    }
  };

  // Use native Google credentials inside Android WebView; keep browser OAuth on the website.
  const handleGoogleSignIn = async () => {
    if (isProcessing) return;
    setLoginError('');
    if (!auth) {
      setLoginError('Firebase is not configured for this app.');
      return;
    }
    setIsProcessing(true);
    const provider = new GoogleAuthProvider();
    provider.setCustomParameters({ prompt: 'select_account' });
    rejectedGoogleUserUid.current = null;
    try {
      let result;
      if (Capacitor.isNativePlatform()) {
        const nativeResult = await FirebaseAuthentication.signInWithGoogle({
          skipNativeAuth: true,
          useCredentialManager: !useLegacyAndroidGoogleAuth,
        });
        const idToken = nativeResult.credential?.idToken;
        if (!idToken) throw new Error('Google sign-in did not return an ID token. Try again.');
        skipBiometricGateRef.current = true;
        result = await signInWithCredential(auth, GoogleAuthProvider.credential(idToken));
      } else {
        result = await signInWithPopup(auth, provider);
      }
      const token = await getIdTokenResult(result.user);
      const profileSnapshot = db ? await getDoc(doc(db, 'users', result.user.uid)) : null;
      const profile = profileSnapshot?.exists() ? profileSnapshot.data() : {};
      const resolvedRole = normalizeRole(token.claims.role || profile.role || LEGACY_ROLE_BY_UID[result.user.uid]);
      if (!resolvedRole) {
        rejectedGoogleUserUid.current = result.user.uid;
        setUser(null);
        setRole(null);
        setUserProfile(null);
        await signOut(auth);
        setLoginError('Access denied: this Google account is not authorized for the rental portal.');
        return;
      }
      triggerWelcome();
    } catch (error) {
      skipBiometricGateRef.current = false;
      const cancelled = error.code === 'auth/popup-closed-by-user' || /cancel(?:led|ed)?/i.test(error.message || '');
      if (!cancelled) {
        setLoginError(error.message?.replace(/^Firebase:\s*/i, '') || 'Google sign-in failed.');
      }
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
    setLoginError('');
    setIsAppLocked(false);
    setBiometricError('');
    skipBiometricGateRef.current = false;
    try {
      if (db && user) {
        try {
          await promiseTimeout(addDoc(collection(db, 'artifacts', appId, 'public', 'data', 'auditLogs'), {
            ...recordDefaults(), actorId: user.uid, actorRole: role, action: 'LOGOUT', entity: 'session', entityId: user.uid, timestamp: new Date().toISOString()
          }), 2500);
        } catch {
          // Signing out must not depend on the audit collection being writable.
        }
      }
    } finally {
      try {
        if (auth) await signOut(auth);
      } catch {
        setLoginError('Unable to contact Firebase, but this session has been cleared from the portal.');
      } finally {
        await Preferences.remove({ key: 'ruiru_last_background_at' }).catch(() => {});
        setUser(null);
        setRole(null);
        setUserProfile(null);
        setSelectedTenant(null);
        setSelectedTenantForDetails(null);
        clearWorkspaceData();
      }
    }
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
  const handleSaveHouse = async (e) => {
    e.preventDefault();
    if (!user || !db || !canManageProperties || isProcessing) return;
    setIsProcessing(true);
    setModalError('');
    try {
      const formData = new FormData(e.target);
      const rawHouseName = formData.get('name').trim();
      const rent = parseMoney(formData.get('rent'), { allowZero: true });
      const type = formData.get('type');

      if (!rawHouseName) throw new Error("Unit name cannot be blank.");
      if (houses.some(h => h.id !== selectedHouseForEdit?.id && h.name.trim().toLowerCase() === rawHouseName.toLowerCase())) {
        throw new Error(`A unit named "${rawHouseName}" already exists in your inventory.`);
      }

      if (selectedHouseForEdit) {
        if (!isLandlord) throw new Error('Only the landlord can edit unit details.');
        await promiseTimeout(updateDoc(documentRef('houses', selectedHouseForEdit.id), {
          name: rawHouseName,
          type,
          rent,
          ...makeRecordMetadata(user, true),
          updatedAt: new Date().toISOString(),
        }), 5000);
        await recordAudit('UNIT_UPDATED', 'unit', selectedHouseForEdit.id, { name: rawHouseName, rent });
      } else {
        const created = await promiseTimeout(addDoc(collection(db, 'artifacts', appId, 'public', 'data', 'houses'), {
          ...recordDefaults(),
          name: rawHouseName, type, rent,
          status: 'VACANT', repairStatus: 'GOOD', createdAt: new Date().toISOString()
        }), 5000);
        await recordAudit('UNIT_CREATED', 'unit', created.id, { name: rawHouseName });
      }
      closeAnyModal(setIsHouseModalOpen);
      setSelectedHouseForEdit(null);
    } catch (err) { setModalError(describeActionError(err, selectedHouseForEdit ? 'updating the property unit' : 'adding the property unit')); } finally { setIsProcessing(false); }
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

      if (!houseId) throw new Error("Please select an available vacant house unit.");
      if (occupiedHouseIds.has(houseId)) throw new Error("That house unit has just been occupied.");
      if (pendingTenantCreationHouseIds.has(houseId)) throw new Error('A registration request for that unit is already waiting for landlord approval.');
      const name = String(formData.get('name') || '').trim();
      const phone = String(formData.get('phone') || '').trim();
      const contactPref = String(formData.get('contactPref') || '').trim();
      if (!name || name.length > 120) throw new Error('Enter a tenant name of up to 120 characters.');
      if (!phone || phone.length > 40) throw new Error('Enter a phone number of up to 40 characters.');

      if (role === ROLES.MANAGER) {
        const tenantRef = doc(collectionRef('tenants'));
        const requestData = {
          ...recordDefaults(),
          action: 'CREATE_TENANT',
          status: 'PENDING',
          tenantId: tenantRef.id,
          tenantName: name,
          phone,
          contactPref,
          houseId,
          requestedByName: String(user.displayName || user.email || user.uid).slice(0, 120),
          requestedAt: new Date().toISOString(),
        };
        const requestRef = await promiseTimeout(addDoc(collectionRef('tenantChangeRequests'), requestData), 5000);
        await recordAudit('TENANT_CREATION_REQUESTED', 'tenant_change_request', requestRef.id, { tenantId: tenantRef.id, houseId });
        closeAnyModal(setIsTenantModalOpen);
        setToastMessage(`Tenant request for ${name} was sent to the landlord for approval.`);
        return;
      }

      if (role !== ROLES.LANDLORD) throw new Error('Your account cannot register tenants.');

      const tenantRef = doc(collection(db, 'artifacts', appId, 'public', 'data', 'tenants'));
      await promiseTimeout(runTransaction(db, async (transaction) => {
        const houseRef = doc(db, 'artifacts', appId, 'public', 'data', 'houses', houseId);
        const cycleRef = activeCycle ? documentRef('billingCycles', activeCycle.id) : null;
        const cycleTenantId = activeCycle ? tenantCycleDocumentId(tenantRef.id, activeCycle.id) : null;
        const cycleTenantRef = cycleTenantId ? documentRef('tenantCycles', cycleTenantId) : null;
        const [houseSnapshot, cycleSnapshot] = await Promise.all([
          transaction.get(houseRef),
          cycleRef ? transaction.get(cycleRef) : Promise.resolve(null),
        ]);
        if (!houseSnapshot.exists() || houseSnapshot.data().status !== 'VACANT') throw new Error('That unit is no longer vacant. Refresh the page and choose another unit.');
        if (cycleSnapshot && (!cycleSnapshot.exists() || cycleSnapshot.data().status !== 'OPEN')) {
          throw new Error('The active billing cycle has changed. Refresh the page and try again.');
        }
        const expectedRent = parseMoney(houseSnapshot.data().rent, { allowZero: true });
        const now = new Date().toISOString();
        const newTenant = {
          ...recordDefaults(),
          name, phone, contactPref,
          houseId, expectedRent, depositAmount: expectedRent, paidRent: 0, paidWater: 0,
          status: 'ACTIVE', dateEntered: now, createdAt: now,
        };
        transaction.set(tenantRef, {
          ...newTenant,
        });
        transaction.update(houseRef, { status: 'OCCUPIED', updatedBy: user.uid, updatedAt: now });
        if (cycleTenantRef) {
          const cycleTenant = {
            tenantId: tenantRef.id,
            cycleId: activeCycle.id,
            tenantName: newTenant.name,
            houseId,
            expectedRent,
            expectedWater: 0,
            paidRent: 0,
            paidWater: 0,
            status: 'OPEN',
            createdAt: now,
            ...recordDefaults(),
          };
          cycleTenant.status = getCycleTenantStatus(cycleTenant);
          transaction.set(cycleTenantRef, cycleTenant);
        }
      }), 5000);
      await recordAudit('TENANT_CREATED', 'tenant', tenantRef.id, { houseId });
      closeAnyModal(setIsTenantModalOpen);
    } catch (err) { setModalError(describeActionError(err, 'registering the tenant')); } finally { setIsProcessing(false); }
  };

  const handleReviewTenantChangeRequest = async (changeRequest, decision) => {
    if (!user || !db || role !== ROLES.LANDLORD || isProcessing || !changeRequest || !['APPROVED', 'REJECTED'].includes(decision)) return;
    setIsProcessing(true);
    setModalError('');
    try {
      const requestRef = documentRef('tenantChangeRequests', changeRequest.id);
      await promiseTimeout(runTransaction(db, async (transaction) => {
        const requestSnapshot = await transaction.get(requestRef);
        if (!requestSnapshot.exists()) throw new Error('This tenant request no longer exists.');
        const request = requestSnapshot.data();
        if (request.status !== 'PENDING') throw new Error('This tenant request has already been reviewed. Refresh the page.');
        if (request.workspaceId !== workspaceId) throw new Error('This request belongs to a different workspace.');
        const now = new Date().toISOString();

        if (decision === 'APPROVED' && request.action === 'CREATE_TENANT') {
          const tenantRef = documentRef('tenants', request.tenantId);
          const houseRef = documentRef('houses', request.houseId);
          const cycleRef = activeCycle ? documentRef('billingCycles', activeCycle.id) : null;
          const cycleTenantRef = activeCycle ? documentRef('tenantCycles', tenantCycleDocumentId(request.tenantId, activeCycle.id)) : null;
          const [tenantSnapshot, houseSnapshot, cycleSnapshot] = await Promise.all([
            transaction.get(tenantRef),
            transaction.get(houseRef),
            cycleRef ? transaction.get(cycleRef) : Promise.resolve(null),
          ]);
          if (tenantSnapshot.exists()) throw new Error('A tenant record already uses this request.');
          if (!houseSnapshot.exists() || houseSnapshot.data().status !== 'VACANT') throw new Error('The requested unit is no longer vacant. Decline this request and ask the manager to submit it again for another vacant unit.');
          if (cycleSnapshot && (!cycleSnapshot.exists() || cycleSnapshot.data().status !== 'OPEN')) throw new Error('The active billing month changed. Refresh and review this request again.');

          const expectedRent = parseMoney(houseSnapshot.data().rent, { allowZero: true });
          const tenant = {
            ...recordDefaults(),
            name: request.tenantName,
            phone: request.phone,
            contactPref: request.contactPref,
            houseId: request.houseId,
            expectedRent,
            depositAmount: expectedRent,
            paidRent: 0,
            paidWater: 0,
            status: 'ACTIVE',
            dateEntered: now,
            createdAt: now,
          };
          transaction.set(tenantRef, tenant);
          transaction.update(houseRef, { status: 'OCCUPIED', ...makeRecordMetadata(user, true), updatedAt: now });
          if (cycleTenantRef && activeCycle) {
            const cycleTenant = {
              tenantId: request.tenantId,
              cycleId: activeCycle.id,
              tenantName: tenant.name,
              houseId: request.houseId,
              expectedRent,
              expectedWater: 0,
              paidRent: 0,
              paidWater: 0,
              status: 'OPEN',
              createdAt: now,
              ...recordDefaults(),
            };
            transaction.set(cycleTenantRef, cycleTenant);
          }
        } else if (decision === 'APPROVED' && request.action === 'DELETE_TENANT') {
          const tenantRef = documentRef('tenants', request.tenantId);
          const tenantSnapshot = await transaction.get(tenantRef);
          if (!tenantSnapshot.exists()) throw new Error('The tenant record no longer exists.');
          const tenant = tenantSnapshot.data();
          if (tenant.status === 'ARCHIVED' || tenant.archivedAt) throw new Error('This tenant has already been removed.');
          if (tenant.houseId !== request.houseId || tenant.name !== request.tenantName) throw new Error('The tenant changed after this request was submitted. Refresh and review the current tenant record.');
          const houseRef = tenant.houseId ? documentRef('houses', tenant.houseId) : null;
          const houseSnapshot = houseRef ? await transaction.get(houseRef) : null;
          if (houseRef && !houseSnapshot.exists()) throw new Error('The tenant’s house unit no longer exists.');
          transaction.update(tenantRef, {
            status: 'ARCHIVED', archivedAt: now, archivedBy: user.uid,
            ...makeRecordMetadata(user, true),
          });
          if (houseRef) transaction.update(houseRef, { status: 'VACANT', ...makeRecordMetadata(user, true), updatedAt: now });
        } else if (decision === 'APPROVED') {
          throw new Error('This request type is not supported.');
        }

        transaction.update(requestRef, {
          status: decision,
          reviewedAt: now,
          reviewedBy: user.uid,
          updatedBy: user.uid,
        });
      }), 10000);
      const approved = decision === 'APPROVED';
      const actionName = changeRequest.action === 'CREATE_TENANT' ? 'registration' : 'removal';
      await recordAudit(`TENANT_${actionName.toUpperCase()}_${decision}`, 'tenant_change_request', changeRequest.id, { tenantId: changeRequest.tenantId });
      setToastMessage(approved
        ? (changeRequest.action === 'CREATE_TENANT' ? `${changeRequest.tenantName} was added to the tenant directory.` : `${changeRequest.tenantName} was removed from the active directory; financial history was retained.`)
        : `The ${actionName} request for ${changeRequest.tenantName} was declined.`);
    } catch (err) {
      setToastMessage(describeActionError(err, 'reviewing the tenant request'));
    } finally {
      setIsProcessing(false);
    }
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
      const targetHouseId = newHouseId || oldHouseId;
      if (!targetHouseId) throw new Error('Assign this tenant to a property unit with a monthly rent first.');
      const isMoving = targetHouseId !== oldHouseId;
      if (isMoving && occupiedHouseIds.has(targetHouseId)) throw new Error("Target house unit is already occupied.");

      await promiseTimeout(runTransaction(db, async (transaction) => {
        const tenantRef = doc(db, 'artifacts', appId, 'public', 'data', 'tenants', selectedTenantForDetails.id);
        const targetHouseRef = documentRef('houses', targetHouseId);
        const oldHouseRef = isMoving && oldHouseId ? documentRef('houses', oldHouseId) : null;
        const cycleRef = activeCycle ? documentRef('billingCycles', activeCycle.id) : null;
        const cycleTenantRef = activeCycle
          ? documentRef('tenantCycles', tenantCycleDocumentId(selectedTenantForDetails.id, activeCycle.id))
          : null;
        const hasCycleTenantInCache = Boolean(activeCycle && activeTenantCycles.has(selectedTenantForDetails.id));
        const [tenantSnapshot, targetHouseSnapshot, cycleSnapshot, cycleTenantSnapshot, oldHouseSnapshot] = await Promise.all([
          transaction.get(tenantRef),
          transaction.get(targetHouseRef),
          cycleRef ? transaction.get(cycleRef) : Promise.resolve(null),
          cycleTenantRef && hasCycleTenantInCache ? transaction.get(cycleTenantRef) : Promise.resolve(null),
          oldHouseRef ? transaction.get(oldHouseRef) : Promise.resolve(null),
        ]);
        if (!tenantSnapshot.exists() || tenantSnapshot.data().status === 'ARCHIVED') throw new Error('This tenant record is no longer active.');
        if (!targetHouseSnapshot.exists() || targetHouseSnapshot.data().status === 'ARCHIVED') throw new Error('Target unit is no longer available.');
        if (isMoving && targetHouseSnapshot.data().status !== 'VACANT') throw new Error('Target unit has already been occupied. Refresh and choose another unit.');
        if (cycleSnapshot && (!cycleSnapshot.exists() || cycleSnapshot.data().status !== 'OPEN')) {
          throw new Error('The active billing cycle has changed. Refresh the page and try again.');
        }
        if (oldHouseRef && !oldHouseSnapshot?.exists()) throw new Error('The tenant’s current house unit no longer exists.');

        const expectedRent = parseMoney(targetHouseSnapshot.data().rent, { allowZero: true });
        const now = new Date().toISOString();
        if (isMoving) {
          transaction.update(targetHouseRef, { status: 'OCCUPIED', updatedBy: user.uid, updatedAt: now });
          transaction.update(oldHouseRef, { status: 'VACANT', updatedBy: user.uid, updatedAt: now });
        }
        transaction.update(tenantRef, {
          name: formData.get('name').trim(), phone: formData.get('phone').trim(), contactPref: formData.get('contactPref'),
          expectedRent, depositAmount: expectedRent, houseId: targetHouseId,
          updatedBy: user.uid, updatedAt: now,
        });
        if (cycleTenantRef && cycleSnapshot?.exists()) {
          const currentCycleTenant = cycleTenantSnapshot?.exists() ? cycleTenantSnapshot.data() : {
            tenantId: selectedTenantForDetails.id,
            cycleId: activeCycle.id,
            tenantName: tenantSnapshot.data().name,
            houseId: targetHouseId,
            expectedRent,
            expectedWater: 0,
            paidRent: 0,
            paidWater: 0,
            status: 'OPEN',
            createdAt: now,
            ...recordDefaults(),
          };
          const nextCycleTenant = {
            ...currentCycleTenant,
            tenantName: formData.get('name').trim(),
            houseId: targetHouseId,
            expectedRent,
          };
          nextCycleTenant.status = getCycleTenantStatus(nextCycleTenant);
          const cycleUpdate = {
            tenantName: nextCycleTenant.tenantName,
            houseId: targetHouseId,
            expectedRent,
            status: nextCycleTenant.status,
            updatedBy: user.uid,
          };
          if (cycleTenantSnapshot?.exists()) transaction.update(cycleTenantRef, cycleUpdate);
          else transaction.set(cycleTenantRef, { ...currentCycleTenant, ...cycleUpdate });
        }
      }), 5000);
      await recordAudit('TENANT_UPDATED', 'tenant', selectedTenantForDetails.id, { houseId: newHouseId || oldHouseId });
      closeAnyModal(setIsEditTenantModalOpen);
      setSelectedTenantForDetails(null);
    } catch (err) { setModalError(describeActionError(err, 'updating tenant details')); } finally { setIsProcessing(false); }
  };

  const handleLogPayment = async (e) => {
    e.preventDefault();
    if (!user || !db || !selectedTenant || isProcessing) return;
    setIsProcessing(true);
    setModalError('');
    try {
      const paymentCycle = selectedPaymentCycle;
      if (!paymentCycle) throw new Error('Create a billing cycle before logging payments.');
      if (paymentCycle.status !== 'OPEN' && !(isLandlord && paymentCycle.status === 'CLOSED')) {
        throw new Error('Only the landlord can record payments against a closed month.');
      }
      const cycleTenant = selectedPaymentTenantCycle;
      if (!cycleTenant) throw new Error('This tenant has no bill in the selected month yet.');

      const formData = new FormData(e.target);
      const amount = parseMoney(formData.get('amount'));
      const type = formData.get('type');
      const messageCode = String(formData.get('messageCode') || '').trim().toUpperCase();
      const method = formData.get('method');
      const paymentDateValue = formData.get('paymentDate');
      const paymentDate = new Date(`${paymentDateValue}T12:00:00`);
      const paymentMonthKey = `${paymentCycle.year}-${String(Number(paymentCycle.monthIndex) + 1).padStart(2, '0')}`;
      if (!paymentDateValue || Number.isNaN(paymentDate.getTime()) || getMonthKey(paymentDate) !== paymentMonthKey) {
        throw new Error(`Choose a payment date within ${paymentCycle.month}.`);
      }
      if (isLandlord && (!messageCode || messageCode === 'N/A')) {
        throw new Error('Enter the transaction reference before recording this payment.');
      }
      if (messageCode === 'N/A') throw new Error('Enter a valid transaction reference code.');

      const paymentRef = doc(collection(db, 'artifacts', appId, 'public', 'data', 'payments'));
      const referenceRef = messageCode
        ? doc(db, 'artifacts', appId, 'public', 'data', 'paymentReferences', encodeURIComponent(messageCode))
        : null;
      const isConfirmed = role === ROLES.LANDLORD;

      await promiseTimeout(runTransaction(db, async (transaction) => {
        const tenantRef = doc(db, 'artifacts', appId, 'public', 'data', 'tenants', selectedTenant.id);
        const cycleRef = documentRef('billingCycles', paymentCycle.id);
        const cycleTenantRef = documentRef('tenantCycles', tenantCycleDocumentId(selectedTenant.id, paymentCycle.id));
        const tenantSnapshot = await transaction.get(tenantRef);
        const cycleSnapshot = await transaction.get(cycleRef);
        const cycleTenantSnapshot = await transaction.get(cycleTenantRef);
        const referenceSnapshot = referenceRef ? await transaction.get(referenceRef) : null;
        if (!tenantSnapshot.exists() || tenantSnapshot.data().status === 'ARCHIVED') throw new Error('This tenant record is no longer active.');
        if (!cycleSnapshot.exists() || (cycleSnapshot.data().status !== 'OPEN' && !(isLandlord && cycleSnapshot.data().status === 'CLOSED'))) throw new Error('The selected billing cycle cannot accept this payment. Refresh and try again.');
        if (!cycleTenantSnapshot.exists()) throw new Error('This tenant does not have a bill in the selected billing cycle.');
        if (referenceSnapshot?.exists()) throw new Error('That payment reference has already been recorded.');

        const currentTenant = tenantSnapshot.data();
        const currentCycleTenant = cycleTenantSnapshot.data();
        if (currentCycleTenant.tenantId !== selectedTenant.id || currentCycleTenant.cycleId !== paymentCycle.id) {
          throw new Error('This tenant billing record does not match the selected cycle.');
        }
        const allocation = allocatePayment(
          amount,
          type,
          Number(currentCycleTenant.expectedRent || 0) - Number(currentCycleTenant.paidRent || 0),
          Number(currentCycleTenant.expectedWater || 0) - Number(currentCycleTenant.paidWater || 0)
        );
        const now = new Date().toISOString();
        transaction.set(paymentRef, {
          workspaceId,
          createdBy: user.uid,
          tenantId: selectedTenant.id, tenantName: currentTenant.name,
          amount, appliedRent: isConfirmed ? allocation.appliedRent : 0,
          appliedWater: isConfirmed ? allocation.appliedWater : 0,
          excessAmount: isConfirmed ? allocation.excessAmount : 0,
          type, method, messageCode, status: isConfirmed ? 'CONFIRMED' : 'PENDING',
          date: paymentDate.toISOString(), loggedBy: role, cycleId: paymentCycle.id
        });
        if (referenceRef) transaction.set(referenceRef, { ...recordDefaults(), paymentId: paymentRef.id, reference: messageCode, createdAt: now });
        if (isConfirmed) {
          const updatedCycleTenant = {
            ...currentCycleTenant,
            paidRent: Number(currentCycleTenant.paidRent || 0) + allocation.appliedRent,
            paidWater: Number(currentCycleTenant.paidWater || 0) + allocation.appliedWater,
          };
          transaction.update(cycleTenantRef, {
            paidRent: updatedCycleTenant.paidRent,
            paidWater: updatedCycleTenant.paidWater,
            status: getCycleTenantStatus(updatedCycleTenant),
            updatedBy: user.uid,
          });
          transaction.update(tenantRef, {
            paidRent: Number(currentTenant.paidRent || 0) + allocation.appliedRent,
            paidWater: Number(currentTenant.paidWater || 0) + allocation.appliedWater,
            updatedBy: user.uid,
          });
        }
      }), 5000);
      await recordAudit('PAYMENT_RECORDED', 'payment', paymentRef.id, { tenantId: selectedTenant.id, amount, status: isConfirmed ? 'CONFIRMED' : 'PENDING' });

      closeAnyModal(setIsPaymentModalOpen);
      setSelectedTenant(null);
    } catch (err) { setModalError(err.message); } finally { setIsProcessing(false); }
  };

  const handleConfirmPayment = async (payment, referenceInput) => {
    if (!user || !db || role !== ROLES.LANDLORD || isProcessing) return;
    setIsProcessing(true);
    setModalError('');
    try {
      const messageCode = String(referenceInput || '').trim().toUpperCase();
      if (!messageCode || messageCode === 'N/A') throw new Error('Enter a valid transaction reference before confirming this payment.');
      const paymentRef = doc(db, 'artifacts', appId, 'public', 'data', 'payments', payment.id);
      const tenantRef = doc(db, 'artifacts', appId, 'public', 'data', 'tenants', payment.tenantId);
      const referenceRef = doc(db, 'artifacts', appId, 'public', 'data', 'paymentReferences', encodeURIComponent(messageCode));
      if (!payment.cycleId) throw new Error('This older payment has no billing cycle and needs manual review.');
      const cycleRef = documentRef('billingCycles', payment.cycleId);
      const cycleTenantRef = documentRef('tenantCycles', tenantCycleDocumentId(payment.tenantId, payment.cycleId));
      await promiseTimeout(runTransaction(db, async (transaction) => {
        const paymentSnapshot = await transaction.get(paymentRef);
        const tenantSnapshot = await transaction.get(tenantRef);
        const cycleSnapshot = await transaction.get(cycleRef);
        const cycleTenantSnapshot = await transaction.get(cycleTenantRef);
        const referenceSnapshot = await transaction.get(referenceRef);
        if (!paymentSnapshot.exists() || paymentSnapshot.data().status !== 'PENDING') throw new Error('This payment has already been reviewed.');
        if (!tenantSnapshot.exists() || tenantSnapshot.data().status === 'ARCHIVED') throw new Error('Tenant is no longer in the directory.');
        if (!cycleSnapshot.exists() || cycleSnapshot.data().status !== 'OPEN') throw new Error('Only payments in an open billing cycle can be confirmed.');
        if (!cycleTenantSnapshot.exists()) throw new Error('The tenant billing record for this cycle is missing.');
        const currentPayment = paymentSnapshot.data();
        const previousCode = String(currentPayment.messageCode || '').trim().toUpperCase();
        const previousReferenceRef = previousCode && previousCode !== 'N/A' && previousCode !== messageCode
          ? doc(db, 'artifacts', appId, 'public', 'data', 'paymentReferences', encodeURIComponent(previousCode))
          : null;
        const previousReferenceSnapshot = previousReferenceRef ? await transaction.get(previousReferenceRef) : null;
        if (referenceSnapshot.exists() && referenceSnapshot.data().paymentId !== payment.id) {
          throw new Error('That payment reference has already been recorded.');
        }
        const currentTenant = tenantSnapshot.data();
        const currentCycleTenant = cycleTenantSnapshot.data();
        const allocation = allocatePayment(
          currentPayment.amount,
          currentPayment.type,
          Number(currentCycleTenant.expectedRent || 0) - Number(currentCycleTenant.paidRent || 0),
          Number(currentCycleTenant.expectedWater || 0) - Number(currentCycleTenant.paidWater || 0)
        );
        const updatedCycleTenant = {
          ...currentCycleTenant,
          paidRent: Number(currentCycleTenant.paidRent || 0) + allocation.appliedRent,
          paidWater: Number(currentCycleTenant.paidWater || 0) + allocation.appliedWater,
        };
        transaction.update(paymentRef, {
          status: 'CONFIRMED', messageCode, ...allocation, updatedBy: user.uid,
        });
        if (!referenceSnapshot.exists()) {
          transaction.set(referenceRef, { ...recordDefaults(), paymentId: payment.id, reference: messageCode, createdAt: new Date().toISOString() });
        }
        if (previousReferenceRef && previousReferenceSnapshot?.exists() && previousReferenceSnapshot.data().paymentId === payment.id) {
          transaction.delete(previousReferenceRef);
        }
        transaction.update(cycleTenantRef, {
          paidRent: updatedCycleTenant.paidRent,
          paidWater: updatedCycleTenant.paidWater,
          status: getCycleTenantStatus(updatedCycleTenant),
          updatedBy: user.uid,
        });
        transaction.update(tenantRef, {
          paidRent: Number(currentTenant.paidRent || 0) + allocation.appliedRent,
          paidWater: Number(currentTenant.paidWater || 0) + allocation.appliedWater,
          updatedBy: user.uid,
        });
      }), 10000);
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
        recordedBy: user.uid, createdAt: new Date().toISOString(), cycleId: activeCycle?.id || null
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
      if (!houseId) throw new Error('Please select a house unit.');
      const now = new Date().toISOString();
      const repairRef = doc(collectionRef('repairs'));
      await promiseTimeout(runTransaction(db, async (transaction) => {
        const houseRef = documentRef('houses', houseId);
        const houseSnapshot = await transaction.get(houseRef);
        if (!houseSnapshot.exists() || houseSnapshot.data().status === 'ARCHIVED') {
          throw new Error('That house unit is no longer available.');
        }
        transaction.set(repairRef, {
          ...recordDefaults(),
          description: formData.get('description').trim(), houseId, status: 'OPEN', cost: 0,
          date: now, createdAt: now, loggedBy: role, loggedByUserId: user.uid, cycleId: activeCycle?.id || null
        });
        transaction.update(houseRef, { repairStatus: 'NEEDS_REPAIR', updatedBy: user.uid, updatedAt: now });
      }), 5000);
      await recordAudit('MAINTENANCE_CREATED', 'maintenance', repairRef.id, { houseId });
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
        transaction.update(repairRef, { status: 'RESOLVED', cost, resolvedAt: now, updatedBy: user.uid });
        transaction.update(houseRef, { repairStatus: 'GOOD', updatedBy: user.uid });
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
        ...recordDefaults(), provider, cost: parseMoney(costStr, { allowZero: true }), date: new Date().toISOString(), loggedBy: role, cycleId: activeCycle?.id || null
      }), 5000);
      await recordAudit('EXPENSE_CREATED', 'septic', created.id, { provider, cost: Number(costStr) });
      closeAnyModal(setIsSepticModalOpen);
    } catch(err) { setModalError(err.message); } finally { setIsProcessing(false); }
  };

  const handleLogGarbage = async (e) => {
    e.preventDefault();
    if (!user || !db || isProcessing) return;
    setIsProcessing(true);
    setModalError('');
    try {
      const formData = new FormData(e.target);
      const provider = String(formData.get('provider') || '').trim();
      const notes = String(formData.get('notes') || '').trim();
      const date = String(formData.get('date') || '');
      if (!provider || provider.length > 80) throw new Error('Enter a collection provider (up to 80 characters).');
      if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) throw new Error('Choose a valid collection date.');
      if (notes.length > 300) throw new Error('Notes must be 300 characters or fewer.');
      const cost = parseMoney(formData.get('cost'), { allowZero: true });
      const createdAt = new Date().toISOString();
      const created = await promiseTimeout(addDoc(collectionRef('garbageLogs'), {
        ...recordDefaults(), provider, cost, date, notes,
        loggedBy: role, cycleId: activeCycle?.id || null, createdAt,
      }), 5000);
      await recordAudit('GARBAGE_COLLECTION_LOGGED', 'garbage_collection', created.id, { provider, cost, date });
      closeAnyModal(setIsGarbageModalOpen);
    } catch (err) {
      setModalError(err.message || 'Could not record the garbage collection.');
    } finally {
      setIsProcessing(false);
    }
  };

  const handleLogWaterBill = async (e) => {
    e.preventDefault();
    if (!user || !db || !canRecordWater || isProcessing) return;
    setIsProcessing(true);
    try {
      const formData = new FormData(e.target);
      const amount = parseMoney(formData.get('amount'));
      const cycleId = formData.get('cycleId') || null;
      const created = await promiseTimeout(addDoc(collection(db, 'artifacts', appId, 'public', 'data', 'masterWaterBills'), {
        ...recordDefaults(), month: formData.get('month').trim(), amount, date: new Date().toISOString(), loggedBy: role, cycleId
      }), 5000);
      await recordAudit('UTILITY_BILL_CREATED', 'utility_bill', created.id, { amount });
      closeAnyModal(setIsWaterBillModalOpen);
    } catch (err) { setModalError(err.message); } finally { setIsProcessing(false); }
  };

  const handleResetWaterVault = async () => {
    if (!user || !db || role !== ROLES.LANDLORD || isProcessing) return;
    if (!window.confirm('Reset the water vault for a new tracking period? Existing payments and provider bills will remain available in history.')) return;
    setIsProcessing(true);
    setModalError('');
    try {
      const date = new Date().toISOString();
      const created = await promiseTimeout(addDoc(collection(db, 'artifacts', appId, 'public', 'data', 'waterVaultResets'), {
        ...recordDefaults(),
        date,
        collectedWaterAtReset: stats.totalWaterCollectedAllTime,
        providerBillsAtReset: stats.totalMasterWaterBills,
        reason: 'MANUAL_RESET',
        createdAt: date,
      }), 5000);
      await recordAudit('WATER_VAULT_RESET', 'water_vault', created.id, {
        collectedWaterAtReset: stats.totalWaterCollectedAllTime,
        providerBillsAtReset: stats.totalMasterWaterBills,
      });
    } catch (err) {
      setModalError(err.message || 'Could not reset the water vault.');
    } finally {
      setIsProcessing(false);
    }
  };

  const handleUpdateBills = async (e) => {
    e.preventDefault();
    if (!user || !db || !selectedTenant || !activeCycle || isProcessing) return;
    setIsProcessing(true);
    setModalError('');
    try {
      const formData = new FormData(e.target);
      const waterShare = parseMoney(formData.get('waterShare'), { allowZero: true });
      const cycleTenantId = tenantCycleDocumentId(selectedTenant.id, activeCycle.id);
      const cycleRef = documentRef('billingCycles', activeCycle.id);
      const cycleTenantRef = documentRef('tenantCycles', cycleTenantId);
      await promiseTimeout(runTransaction(db, async (transaction) => {
        const [cycleSnapshot, cycleTenantSnapshot] = await Promise.all([
          transaction.get(cycleRef),
          transaction.get(cycleTenantRef),
        ]);
        if (!cycleSnapshot.exists() || cycleSnapshot.data().status !== 'OPEN') throw new Error('The billing cycle is no longer open. Refresh and try again.');
        if (!cycleTenantSnapshot.exists()) throw new Error('This tenant is not set up in the active billing cycle yet.');
        const currentCycleTenant = cycleTenantSnapshot.data();
        const nextCycleTenant = {
          ...currentCycleTenant,
          expectedWater: waterShare,
        };
        transaction.update(cycleTenantRef, {
          expectedWater: nextCycleTenant.expectedWater,
          status: getCycleTenantStatus(nextCycleTenant),
          updatedBy: user.uid,
        });
      }), 10000);
      await recordAudit('TENANT_WATER_SHARE_SET', 'tenant', selectedTenant.id, { waterShare, cycleId: activeCycle.id });
      closeAnyModal(setIsBillingModalOpen);
      setSelectedTenant(null);
    } catch (err) { setModalError(describeActionError(err, 'updating this month’s tenant water bill')); } finally { setIsProcessing(false); }
  };

  const handleUpdateClosedCycleCharges = async (e) => {
    e.preventDefault();
    if (!user || !db || !isLandlord || !selectedTenantCycleForEdit || isProcessing) return;
    setIsProcessing(true);
    setModalError('');
    try {
      const formData = new FormData(e.target);
      const expectedRent = parseMoney(formData.get('expectedRent'), { allowZero: true });
      const expectedWater = parseMoney(formData.get('expectedWater'), { allowZero: true });
      const cycleTenant = selectedTenantCycleForEdit;
      const cycleRef = documentRef('billingCycles', cycleTenant.cycleId);
      const cycleTenantRef = documentRef('tenantCycles', cycleTenant.id);
      await promiseTimeout(runTransaction(db, async (transaction) => {
        const [cycleSnapshot, cycleTenantSnapshot] = await Promise.all([
          transaction.get(cycleRef),
          transaction.get(cycleTenantRef),
        ]);
        if (!cycleSnapshot.exists() || cycleSnapshot.data().status !== 'CLOSED') throw new Error('Historical bills can only be edited after the month is closed.');
        if (!cycleTenantSnapshot.exists()) throw new Error('This tenant bill no longer exists. Refresh the page and try again.');
        const current = cycleTenantSnapshot.data();
        if (expectedRent < Number(current.paidRent || 0) || expectedWater < Number(current.paidWater || 0)) {
          throw new Error('A bill cannot be reduced below the amount already paid for that charge.');
        }
        const next = { ...current, expectedRent, expectedWater };
        transaction.update(cycleTenantRef, {
          expectedRent,
          expectedWater,
          status: finalizeTenantCycle(next).status,
          updatedBy: user.uid,
        });
      }), 10000);
      await recordAudit('HISTORICAL_BILL_UPDATED', 'tenant_cycle', cycleTenant.id, {
        cycleId: cycleTenant.cycleId, expectedRent, expectedWater,
      });
      setIsCycleChargeModalOpen(false);
      setSelectedTenantCycleForEdit(null);
    } catch (err) {
      setModalError(describeActionError(err, 'updating the historical tenant bill'));
    } finally {
      setIsProcessing(false);
    }
  };

  const handleDeleteTenant = async (tenant) => {
    if (!user || !db || !tenant || isProcessing) return;
    if (role === ROLES.LANDLORD) {
      setConfirmationAction({ type: 'deleteTenant', tenant });
    } else if (role === ROLES.MANAGER) {
      setConfirmationAction({ type: 'requestTenantRemoval', tenant });
    }
  };

  const handleOpenCycle = async (e) => {
    e.preventDefault();
    if (!user || !db || role !== ROLES.LANDLORD || isProcessing) return;
    setIsProcessing(true);
    setModalError('');
    try {
      const year = Number(cycleYear);
      const monthIndex = Number(cycleMonth);
      if (!Number.isInteger(year) || year < 2000 || year > 2200 || monthIndex < 0 || monthIndex > 11) {
        throw new Error('Choose a valid month and year.');
      }
      if (activeCycle && payments.some(payment => payment.cycleId === activeCycle.id && payment.status === 'PENDING')) {
        throw new Error('Review all pending payments before opening another billing cycle.');
      }
      if (billingCycles.some(cycle => Number(cycle.year) === year && Number(cycle.monthIndex) === monthIndex)) {
        throw new Error('A billing cycle already exists for that month.');
      }

      const currentTenants = activeTenants;
      const tenantHousing = currentTenants.map(tenant => ({
        tenant,
        house: houses.find(house => house.id === tenant.houseId),
      }));
      if (tenantHousing.some(({ house }) => !house || !Number.isFinite(Number(house.rent)))) {
        throw new Error('Every active tenant needs an assigned property with a valid monthly rent before opening a billing cycle.');
      }
      const currentTenantCycles = activeCycle
        ? tenantCycles.filter(cycleTenant => cycleTenant.cycleId === activeCycle.id)
        : [];
      const writeCount = 1 + currentTenants.length + (activeCycle ? 1 + currentTenantCycles.length : 0);
      if (writeCount > 500) throw new Error('This month has too many records to open safely in a single Firestore batch.');

      const now = new Date().toISOString();
      const cycleRef = doc(collectionRef('billingCycles'));
      const cycleData = {
        id: cycleRef.id,
        month: createCycleLabel(year, monthIndex),
        year,
        monthIndex,
        status: 'OPEN',
        openedAt: now,
        closedAt: null,
        openedBy: 'LANDLORD',
        ...makeRecordMetadata(user),
      };
      const batch = writeBatch(db);
      batch.set(cycleRef, cycleData);
      if (activeCycle) {
        batch.update(documentRef('billingCycles', activeCycle.id), {
          status: 'CLOSED', closedAt: now, ...makeRecordMetadata(user, true),
        });
        currentTenantCycles.forEach(cycleTenant => {
          const finalized = finalizeTenantCycle(cycleTenant);
          batch.update(documentRef('tenantCycles', cycleTenant.id), {
            status: finalized.status,
            ...makeRecordMetadata(user, true),
          });
        });
      }
      tenantHousing.forEach(({ tenant, house }) => {
        const cycleTenantId = tenantCycleDocumentId(tenant.id, cycleRef.id);
        const cycleTenant = {
          tenantId: tenant.id,
          cycleId: cycleRef.id,
          tenantName: tenant.name,
          houseId: tenant.houseId || '',
          expectedRent: Number(house.rent || 0),
          expectedWater: 0,
          paidRent: 0,
          paidWater: 0,
          status: 'OPEN',
          createdAt: now,
          ...makeRecordMetadata(user),
        };
        cycleTenant.status = getCycleTenantStatus(cycleTenant);
        batch.set(documentRef('tenantCycles', cycleTenantId), cycleTenant);
      });
      await promiseTimeout(batch.commit(), 15000);
      await recordAudit('BILLING_CYCLE_OPENED', 'billing_cycle', cycleRef.id, { month: cycleData.month });
      setSelectedDashboardCycleId('ACTIVE');
      setIsCycleModalOpen(false);
      setToastMessage(`${cycleData.month} billing cycle opened.`);
    } catch (error) {
      setModalError(error.message || 'Could not open the billing cycle.');
    } finally {
      setIsProcessing(false);
    }
  };

  const handleBackfillCycle = async (e) => {
    e.preventDefault();
    if (!user || !db || !isLandlord || isProcessing) return;
    setIsProcessing(true);
    setModalError('');
    try {
      const year = Number(backfillCycleYear);
      const monthIndex = Number(backfillCycleMonth);
      if (!Number.isInteger(year) || year < 2000 || year > 2200 || monthIndex < 0 || monthIndex > 11) {
        throw new Error('Choose a valid month and year.');
      }
      const monthKey = `${year}-${String(monthIndex + 1).padStart(2, '0')}`;
      if (monthKey >= createCurrentMonthKey()) throw new Error('Backfill is only for a month before the current month.');
      if (billingCycles.some(cycle => Number(cycle.year) === year && Number(cycle.monthIndex) === monthIndex)) {
        throw new Error('A billing cycle already exists for that month. Select it from monthly history to edit or record payments.');
      }

      const tenantHousing = activeTenants.map(tenant => ({
        tenant,
        house: houses.find(house => house.id === tenant.houseId),
      }));
      if (tenantHousing.some(({ house }) => !house || !Number.isFinite(Number(house.rent)))) {
        throw new Error('Every active tenant needs an assigned property with a valid rent before a past month can be created.');
      }
      if (tenantHousing.length + 1 > 500) throw new Error('There are too many tenant records to create this past month in one safe operation.');

      const month = String(monthIndex + 1).padStart(2, '0');
      const cycleId = `backfill-${year}-${month}`;
      const cycleRef = documentRef('billingCycles', cycleId);
      const existingCycleSnapshot = await promiseTimeout(getDoc(cycleRef), 5000);
      if (existingCycleSnapshot.exists()) throw new Error('A record already uses this month identifier. Refresh monthly history before continuing.');
      const openedAt = new Date(year, monthIndex, 1).toISOString();
      const closedAt = new Date(year, monthIndex + 1, 0, 23, 59, 59, 999).toISOString();
      const cycleData = {
        id: cycleId,
        month: createCycleLabel(year, monthIndex),
        year,
        monthIndex,
        status: 'CLOSED',
        openedAt,
        closedAt,
        openedBy: 'LANDLORD',
        ...makeRecordMetadata(user),
      };
      const batch = writeBatch(db);
      batch.set(cycleRef, cycleData);
      tenantHousing.forEach(({ tenant, house }) => {
        const cycleTenant = {
          tenantId: tenant.id,
          cycleId,
          tenantName: tenant.name,
          houseId: tenant.houseId || '',
          expectedRent: Number(house.rent || 0),
          expectedWater: 0,
          paidRent: 0,
          paidWater: 0,
          status: 'OPEN',
          createdAt: openedAt,
          ...makeRecordMetadata(user),
        };
        cycleTenant.status = finalizeTenantCycle(cycleTenant).status;
        batch.set(documentRef('tenantCycles', tenantCycleDocumentId(tenant.id, cycleId)), cycleTenant);
      });
      await promiseTimeout(batch.commit(), 15000);
      await recordAudit('HISTORICAL_BILLING_CYCLE_CREATED', 'billing_cycle', cycleId, { month: cycleData.month });
      setSelectedDashboardCycleId(cycleId);
      setIsBackfillCycleModalOpen(false);
      setToastMessage(`${cycleData.month} added to history. Review the rent and water amounts before recording past payments.`);
    } catch (error) {
      setModalError(error.message || 'Could not add the past billing month.');
    } finally {
      setIsProcessing(false);
    }
  };

  const handleCloseCycle = async () => {
    if (!user || !db || role !== ROLES.LANDLORD || !activeCycle) return;
    if (payments.some(payment => payment.cycleId === activeCycle.id && payment.status === 'PENDING')) {
      throw new Error('Review all pending payments before closing this billing cycle.');
    }
    const currentTenantCycles = tenantCycles.filter(cycleTenant => cycleTenant.cycleId === activeCycle.id);
    if (currentTenantCycles.length + 1 > 500) throw new Error('This billing cycle has too many records to close in one safe operation.');
    const now = new Date().toISOString();
    const batch = writeBatch(db);
    currentTenantCycles.forEach(cycleTenant => {
      const finalized = finalizeTenantCycle(cycleTenant);
      batch.update(documentRef('tenantCycles', cycleTenant.id), {
        status: finalized.status,
        ...makeRecordMetadata(user, true),
      });
    });
    batch.update(documentRef('billingCycles', activeCycle.id), {
      status: 'CLOSED', closedAt: now, ...makeRecordMetadata(user, true),
    });
    await promiseTimeout(batch.commit(), 15000);
    await recordAudit('BILLING_CYCLE_CLOSED', 'billing_cycle', activeCycle.id, { month: activeCycle.month });
    setSelectedDashboardCycleId('ACTIVE');
    setToastMessage(`${activeCycle.month} billing cycle closed.`);
  };

  const handleDataReset = async () => {
    if (!user || !db || role !== ROLES.LANDLORD) return;
    const isLegacyAccount = Boolean(LEGACY_ROLE_BY_UID[user.uid]);
    const scopedCollection = (collectionName) => {
      const ref = collectionRef(collectionName);
      return isLegacyAccount ? ref : query(ref, where('workspaceId', '==', workspaceId));
    };
    const collectionSnapshots = await promiseTimeout(
      Promise.all([
        'payments', 'paymentReferences', 'repairs', 'septicLogs', 'garbageLogs', 'masterWaterBills',
        'tenants', 'tenantCycles', 'billingCycles',
      ].map(collectionName => getDocs(scopedCollection(collectionName)))),
      15000,
    );
    // Legacy listeners can read unscoped records for compatibility, but reset
    // writes must follow the same workspace boundary enforced by Firestore.
    const scopedSnapshots = collectionSnapshots.map(snapshot => snapshot.docs.filter(record =>
      canAccessWorkspaceRecord(record.data(), workspaceId, isLegacyAccount),
    ));
    const skippedOutOfWorkspaceRecords = collectionSnapshots.reduce(
      (total, snapshot, index) => total + snapshot.docs.length - scopedSnapshots[index].length,
      0,
    );
    const [paymentDocs, referenceDocs, repairDocs, septicDocs, garbageDocs, waterBillDocs, tenantDocs, tenantCycleDocs, cycleDocs] = scopedSnapshots;
    const openCycles = cycleDocs.filter(cycle => cycle.data().status === 'OPEN');
    if (openCycles.length > 1) throw new Error('More than one billing cycle is open. Resolve the duplicate open cycles before resetting data.');
    const cycleStatusById = new Map(cycleDocs.map(cycle => [cycle.id, cycle.data().status]));
    const deleteOperations = [
      ...paymentDocs.map(payment => batch => batch.delete(documentRef('payments', payment.id))),
      ...referenceDocs.map(reference => batch => batch.delete(documentRef('paymentReferences', reference.id))),
      ...repairDocs.map(repair => batch => batch.delete(documentRef('repairs', repair.id))),
      ...septicDocs.map(log => batch => batch.delete(documentRef('septicLogs', log.id))),
      ...garbageDocs.map(log => batch => batch.delete(documentRef('garbageLogs', log.id))),
      ...waterBillDocs.map(bill => batch => batch.delete(documentRef('masterWaterBills', bill.id))),
    ];
    const tenantBalanceOperations = tenantDocs.map(tenant => batch => batch.update(documentRef('tenants', tenant.id), {
        paidRent: 0, paidWater: 0, ...makeRecordMetadata(user, true),
    }));
    const cycleResetOperations = tenantCycleDocs
      .filter(cycleTenant => cycleStatusById.has(cycleTenant.data().cycleId))
      .map(cycleTenant => batch => {
        const data = cycleTenant.data();
        const resetTenantCycle = { ...data, paidRent: 0, paidWater: 0 };
        const status = cycleStatusById.get(data.cycleId) === 'OPEN'
          ? getCycleTenantStatus(resetTenantCycle)
          : finalizeTenantCycle(resetTenantCycle).status;
        batch.update(documentRef('tenantCycles', cycleTenant.id), {
          paidRent: 0, paidWater: 0, status, ...makeRecordMetadata(user, true),
        });
      });
    const commitResetStage = async (resetStage, stageOperations, chunkSize) => {
      try {
        await commitBatches(stageOperations, chunkSize);
      } catch (error) {
        const stageError = new Error(error.message || 'Firestore rejected the write.');
        stageError.code = error.code;
        stageError.resetStage = resetStage;
        stageError.partialReset = true;
        throw stageError;
      }
    };

    // Clear cycle balances before deleting their payment history. If a cycle
    // update is denied, the original payment records are still available.
    await commitResetStage('monthly tenant-cycle balances', cycleResetOperations, 15);
    await commitResetStage('tenant balance totals', tenantBalanceOperations);
    await commitResetStage('payment, reference, repair, septic, garbage, and water-invoice records', deleteOperations);
    await recordAudit('OPERATIONAL_DATA_RESET', 'workspace', workspaceId, { deletedPayments: paymentDocs.length });
    const skippedNotice = skippedOutOfWorkspaceRecords > 0
      ? ` ${skippedOutOfWorkspaceRecords} record(s) outside this workspace were left unchanged.`
      : '';
    setToastMessage(`Data reset completed. Houses and tenant charges were preserved.${skippedNotice}`);
  };

  const handleConfirmationSubmit = async () => {
    const managerRemovalRequest = role === ROLES.MANAGER && confirmationAction?.type === 'requestTenantRemoval';
    if (!user || !db || (role !== ROLES.LANDLORD && !managerRemovalRequest) || !confirmationAction || isProcessing) return;
    setIsProcessing(true);
    setModalError('');
    try {
      if (confirmationAction.type === 'requestTenantRemoval') {
        const tenant = confirmationAction.tenant;
        if (!tenant || tenant.status === 'ARCHIVED' || tenant.archivedAt) throw new Error('This tenant is no longer active. Refresh the directory.');
        if (tenantChangeRequests.some(request => request.action === 'DELETE_TENANT' && request.tenantId === tenant.id && request.status === 'PENDING')) throw new Error('A removal request for this tenant is already waiting for landlord approval.');
        const request = {
          ...recordDefaults(),
          action: 'DELETE_TENANT',
          status: 'PENDING',
          tenantId: tenant.id,
          tenantName: tenant.name,
          phone: String(tenant.phone || ''),
          contactPref: String(tenant.contactPref || ''),
          houseId: String(tenant.houseId || ''),
          requestedByName: String(user.displayName || user.email || user.uid).slice(0, 120),
          requestedAt: new Date().toISOString(),
        };
        const created = await promiseTimeout(addDoc(collectionRef('tenantChangeRequests'), request), 5000);
        await recordAudit('TENANT_REMOVAL_REQUESTED', 'tenant_change_request', created.id, { tenantId: tenant.id, houseId: tenant.houseId });
        setSelectedTenantForDetails(null);
        setToastMessage(`Removal request for ${tenant.name} was sent to the landlord. The tenant remains active until approval.`);
      } else if (confirmationAction.type === 'resetData') {
        await handleDataReset();
      } else if (confirmationAction.type === 'closeCycle') {
        await handleCloseCycle();
      } else if (confirmationAction.type === 'deleteTenant') {
        const tenant = confirmationAction.tenant;
        await promiseTimeout(runTransaction(db, async (transaction) => {
          const tenantRef = documentRef('tenants', tenant.id);
          const tenantSnapshot = await transaction.get(tenantRef);
          if (!tenantSnapshot.exists()) throw new Error('Tenant record no longer exists.');
          const currentTenant = tenantSnapshot.data();
          if (currentTenant.status === 'ARCHIVED' || currentTenant.archivedAt) throw new Error('This tenant has already been archived.');
          const houseRef = currentTenant.houseId ? documentRef('houses', currentTenant.houseId) : null;
          const houseSnapshot = houseRef ? await transaction.get(houseRef) : null;
          if (houseRef && !houseSnapshot.exists()) throw new Error('The tenant’s house unit no longer exists.');
          const now = new Date().toISOString();
          transaction.update(tenantRef, {
            status: 'ARCHIVED', archivedAt: now, archivedBy: user.uid,
            ...makeRecordMetadata(user, true),
          });
          if (houseRef) transaction.update(houseRef, { status: 'VACANT', ...makeRecordMetadata(user, true) });
        }), 10000);
        await recordAudit('TENANT_ARCHIVED', 'tenant', tenant.id, { houseId: tenant.houseId });
        setSelectedTenantForDetails(null);
        setToastMessage(`${tenant.name} was removed from the active tenant directory.`);
      }
      setConfirmationAction(null);
    } catch (error) {
      const action = confirmationAction.type === 'resetData'
        ? 'resetting payment and operations data'
        : confirmationAction.type === 'deleteTenant' ? 'removing the tenant'
          : confirmationAction.type === 'requestTenantRemoval' ? 'requesting landlord approval to remove the tenant'
            : 'closing the billing cycle';
      setModalError(describeActionError(error, action));
    } finally {
      setIsProcessing(false);
    }
  };

  // --- REBUILT ACCOUNTING MATH ENGINE ---
  const stats = (() => {
    let collectedRentRev = 0, collectedWaterRev = 0, totalJosephBonus = 0, pendingPaymentsCount = 0;
    let totalRepairExpenses = 0, totalSepticExpenses = 0, totalGarbageExpenses = 0, totalMasterWaterBills = 0;

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
      const cycleTenant = activeTenantCycles.get(t.id);
      const house = houses.find(item => item.id === t.houseId);
      const rBal = Number(cycleTenant?.expectedRent ?? house?.rent ?? t.expectedRent ?? 0) -
        Number(cycleTenant?.paidRent ?? t.paidRent ?? 0);
      const wBal = Number(cycleTenant?.expectedWater ?? t.expectedWater ?? 0) -
        Number(cycleTenant?.paidWater ?? t.paidWater ?? 0);
      if (rBal > 0) activeRentArrears += rBal;
      if (wBal > 0) activeWaterArrears += wBal;
    });

    const expectedRentRev = collectedRentRev + activeRentArrears;
    const expectedWaterRev = collectedWaterRev + activeWaterArrears;

    repairs.forEach(r => { if (r.status === 'RESOLVED' && r.cost) totalRepairExpenses += r.cost; });
    septicLogs.forEach(s => { if (s.cost) totalSepticExpenses += s.cost; });
    garbageLogs.forEach(log => { totalGarbageExpenses += Number(log.cost || 0); });
    masterWaterBills.forEach(m => { if (m.amount) totalMasterWaterBills += m.amount; });
    const latestWaterVaultReset = waterVaultResets[0];
    const collectedWaterSinceReset = Math.max(0, collectedWaterRev - Number(latestWaterVaultReset?.collectedWaterAtReset || 0));
    const providerBillsSinceReset = Math.max(0, totalMasterWaterBills - Number(latestWaterVaultReset?.providerBillsAtReset || 0));
    const waterReserve = collectedWaterSinceReset - providerBillsSinceReset;
    const occupiedUnits = houses.filter(h => h.status === 'OCCUPIED' || occupiedHouseIds.has(h.id)).length;
    const totalOperatingExpensesWithRecords = totalRepairExpenses + totalSepticExpenses + totalGarbageExpenses + expenses
      .filter(expense => expense.status !== 'REJECTED')
      .reduce((sum, expense) => sum + Number(expense.amount || 0), 0);

    return {
      expectedRentRev, collectedRentRev, expectedWaterRev, collectedWaterRev: collectedWaterSinceReset,
      totalWaterCollectedAllTime: collectedWaterRev, totalWaterBillsSinceReset: providerBillsSinceReset,
      pendingPaymentsCount, totalJosephBonus, totalOperatingExpenses: totalOperatingExpensesWithRecords, totalMasterWaterBills, waterReserve,
      vacantHouses: houses.filter(h => h.status === 'VACANT' && !occupiedHouseIds.has(h.id)).length,
      openRepairs: repairs.filter(r => r.status === 'OPEN').length,
      totalRepairExpenses, totalSepticExpenses, totalGarbageExpenses, totalUnits: houses.length, occupiedUnits,
      occupancyRate: houses.length ? Math.round((occupiedUnits / houses.length) * 100) : 0,
      netOperatingResult: collectedRentRev - totalOperatingExpensesWithRecords,
    };
  })();

  const cyclePayments = useMemo(() => (
    viewedCycle ? payments.filter(payment => payment.cycleId === viewedCycle.id) : []
  ), [viewedCycle, payments]);

  const cycleStats = useMemo(() => {
    let collectedRentRev = 0;
    let collectedWaterRev = 0;
    let totalJosephBonus = 0;
    let pendingPaymentsCount = 0;
    let activeRentArrears = 0;
    let activeWaterArrears = 0;
    let totalRepairExpenses = 0;
    let totalSepticExpenses = 0;
    let totalGarbageExpenses = 0;
    let totalMasterWaterBills = 0;
    let totalOtherExpenses = 0;
    const cycleId = viewedCycle?.id;
    const currentTenantCycles = cycleId
      ? tenantCycles.filter(cycleTenant => cycleTenant.cycleId === cycleId)
      : [];

    cyclePayments.forEach(payment => {
      if (payment.status === 'CONFIRMED') {
        collectedRentRev += Number(payment.appliedRent || 0);
        collectedWaterRev += Number(payment.appliedWater || 0);
        totalJosephBonus += Number(payment.excessAmount || 0);
      }
      if (payment.status === 'PENDING') pendingPaymentsCount += 1;
    });
    currentTenantCycles.forEach(cycleTenant => {
      activeRentArrears += Math.max(0, Number(cycleTenant.expectedRent || 0) - Number(cycleTenant.paidRent || 0));
      activeWaterArrears += Math.max(0, Number(cycleTenant.expectedWater || 0) - Number(cycleTenant.paidWater || 0));
    });

    repairs.forEach(repair => {
      if (repair.cycleId === cycleId && repair.status === 'RESOLVED') totalRepairExpenses += Number(repair.cost || 0);
    });
    septicLogs.forEach(log => {
      if (log.cycleId === cycleId) totalSepticExpenses += Number(log.cost || 0);
    });
    garbageLogs.forEach(log => {
      if (log.cycleId === cycleId) totalGarbageExpenses += Number(log.cost || 0);
    });
    masterWaterBills.forEach(bill => {
      if (bill.cycleId === cycleId) totalMasterWaterBills += Number(bill.amount || 0);
    });
    expenses.forEach(expense => {
      if (expense.cycleId === cycleId && expense.status !== 'REJECTED') totalOtherExpenses += Number(expense.amount || 0);
    });

    const expectedRentRev = collectedRentRev + activeRentArrears;
    const expectedWaterRev = collectedWaterRev + activeWaterArrears;
    const waterReserve = collectedWaterRev - totalMasterWaterBills;
    return {
      expectedRentRev,
      collectedRentRev,
      expectedWaterRev,
      collectedWaterRev,
      pendingPaymentsCount,
      totalJosephBonus,
      totalOperatingExpenses: totalRepairExpenses + totalSepticExpenses + totalGarbageExpenses + totalOtherExpenses,
      totalMasterWaterBills,
      waterReserve,
      vacantHouses: houses.filter(house => house.status === 'VACANT' && !occupiedHouseIds.has(house.id)).length,
      openRepairs: repairs.filter(repair => repair.cycleId === cycleId && repair.status === 'OPEN').length,
      totalRepairExpenses,
      totalSepticExpenses,
      totalGarbageExpenses
    };
  }, [viewedCycle, cyclePayments, tenantCycles, repairs, septicLogs, garbageLogs, masterWaterBills, expenses, houses, occupiedHouseIds]);

  const billingCycleHistory = useMemo(() => billingCycles
    .filter(cycle => cycle.status === 'CLOSED')
    .map(cycle => {
      const cyclePaymentsForHistory = payments.filter(payment => payment.cycleId === cycle.id && payment.status === 'CONFIRMED');
      const cycleTenantRecords = tenantCycles.filter(cycleTenant => cycleTenant.cycleId === cycle.id);
      return {
        ...cycle,
        rentCollected: cyclePaymentsForHistory.reduce((total, payment) => total + Number(payment.appliedRent || 0), 0),
        waterCollected: cyclePaymentsForHistory.reduce((total, payment) => total + Number(payment.appliedWater || 0), 0),
        clearedCount: cycleTenantRecords.filter(cycleTenant => cycleTenant.status === 'CLEARED').length,
        arrearsCount: cycleTenantRecords.filter(cycleTenant => cycleTenant.status === 'ARREARS').length
      };
    }), [billingCycles, payments, tenantCycles]);

  const normalizedSearch = globalSearch.trim().toLowerCase();
  const filteredPayments = useMemo(() => payments.filter(payment => {
    const matchesMonth = paymentMonthFilter === 'ALL' || getMonthKey(payment.date) === paymentMonthFilter;
    const searchRecord = `${payment.tenantName} ${payment.messageCode || ''} ${payment.type} ${payment.method}`.toLowerCase();
    return matchesMonth && (!normalizedSearch || searchRecord.includes(normalizedSearch));
  }), [payments, paymentMonthFilter, normalizedSearch]);

  const tenantPaymentHistory = useMemo(() => {
    if (!selectedTenant) return [];
    return payments.filter(p => p.tenantId === selectedTenant.id && p.status === 'CONFIRMED');
  }, [selectedTenant, payments]);

  const houseNameById = useMemo(() => new Map(houses.map(house => [house.id, house.name || ''])), [houses]);
  const tenantById = useMemo(() => new Map(activeTenants.map(tenant => [tenant.id, tenant])), [activeTenants]);
  const filteredHouses = useMemo(() => houses.filter(house => !normalizedSearch || `${house.name} ${house.type}`.toLowerCase().includes(normalizedSearch)), [houses, normalizedSearch]);
  const filteredTenants = useMemo(() => activeTenants.filter(tenant => {
    const house = houses.find(h => h.id === tenant.houseId);
    return !normalizedSearch || `${tenant.name} ${tenant.phone} ${house?.name || ''}`.toLowerCase().includes(normalizedSearch);
  }), [activeTenants, houses, normalizedSearch]);
  const filteredRepairs = useMemo(() => repairs.filter(repair => !normalizedSearch || `${repair.description} ${houses.find(h => h.id === repair.houseId)?.name || ''}`.toLowerCase().includes(normalizedSearch)), [repairs, houses, normalizedSearch]);
  const sortedHouses = useMemo(() => [...filteredHouses].sort((a, b) => compareNatural(a.name, b.name)), [filteredHouses]);
  const sortedTenants = useMemo(() => [...filteredTenants].sort((a, b) => (
    compareNatural(houseNameById.get(a.houseId), houseNameById.get(b.houseId)) || compareNatural(a.name, b.name)
  )), [filteredTenants, houseNameById]);
  const sortedBillingTenants = useMemo(() => [...filteredBillingTenants].sort((a, b) => (
    compareNatural(houseNameById.get(a.houseId), houseNameById.get(b.houseId)) || compareNatural(a.name, b.name)
  )), [filteredBillingTenants, houseNameById]);
  const sortedPayments = useMemo(() => [...filteredPayments].sort((a, b) => (
    compareNatural(houseNameById.get(tenantById.get(a.tenantId)?.houseId), houseNameById.get(tenantById.get(b.tenantId)?.houseId)) ||
    (new Date(b.date) - new Date(a.date))
  )), [filteredPayments, houseNameById, tenantById]);

  const can = (permission) => hasPermission(role, permission, userProfile?.permissions);
  const paymentMethods = useMemo(() => {
    const configured = Array.isArray(userProfile?.paymentMethods)
      ? userProfile.paymentMethods
      : ['M-Pesa', 'Bank Transfer', 'Other'];
    const available = configured.filter(method => typeof method === 'string' && method.trim() && method.trim().toLowerCase() !== 'cash');
    return available.length ? available : ['M-Pesa', 'Bank Transfer', 'Other'];
  }, [userProfile]);

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
        <p className={`font-bold text-sm tracking-widest uppercase opacity-80 animate-pulse ${theme === 'dark' ? 'text-slate-300' : 'text-gray-600'}`}>Ruiru Rentals Syncing...</p>
      </div>
    );
  }

  if (user && isAppLocked) {
    return (
      <main className={`flex min-h-[100svh] items-center justify-center px-5 py-10 ${theme === 'dark' ? 'bg-[#171717] text-slate-100' : 'bg-[#f6f4ef] text-slate-900'}`}>
        <section className={`w-full max-w-md rounded-2xl border p-8 text-center shadow-xl ${theme === 'dark' ? 'border-[#383838] bg-[#1f1f1f]' : 'border-[#e7e1d7] bg-[#fffdf9]'}`}>
          <div className={`mx-auto mb-5 flex h-16 w-16 items-center justify-center rounded-full ${theme === 'dark' ? 'bg-[#303030] text-slate-100' : 'bg-[#eee9df] text-slate-800'}`}>
            <Fingerprint size={34} aria-hidden="true" />
          </div>
          <h1 className="text-2xl font-semibold">Ruiru Rentals is locked</h1>
          <p className={`mt-2 text-sm ${theme === 'dark' ? 'text-slate-300' : 'text-slate-600'}`}>
            Use your {biometricLabel} to return to your workspace.
          </p>
          {biometricError && <p role="alert" className="mt-5 rounded-lg border border-rose-300 bg-rose-50 px-3 py-2 text-sm text-rose-700">{biometricError}</p>}
          <button type="button" onClick={() => void requestBiometricUnlock()} className={`mt-6 flex w-full items-center justify-center gap-2 rounded-xl px-4 py-3.5 text-sm font-semibold text-white ${theme === 'dark' ? 'bg-[#383838] hover:bg-[#505050]' : 'bg-slate-900 hover:bg-slate-800'}`}>
            <Fingerprint size={18} aria-hidden="true" /> Unlock with {biometricLabel}
          </button>
          <button type="button" onClick={handleLogout} className={`mt-3 w-full rounded-xl px-4 py-3 text-sm font-semibold transition ${theme === 'dark' ? 'text-slate-300 hover:bg-white/5' : 'text-slate-600 hover:bg-black/5'}`}>
            Sign in with password instead
          </button>
        </section>
      </main>
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
        <p className={`font-medium text-lg ${theme === 'dark' ? 'text-slate-300' : 'text-gray-600'}`}>Preparing your secure workspace...</p>
      </div>
    );
  }

  if (!user) {
    return (
      <main className={`auth-shell ${theme === 'dark' ? 'dark' : 'light'} flex min-h-[100svh] items-center justify-center px-5 py-10 ${theme === 'dark' ? 'bg-[#171717]' : 'bg-[#f6f4ef]'}`}>
        <section className={`flex w-full max-w-[520px] items-center justify-center ${theme === 'dark' ? 'text-slate-100' : 'text-slate-900'}`}>
          <div className="w-full max-w-[440px]">
            <div className={`app-enter rounded-2xl border p-6 shadow-xl sm:p-9 ${theme === 'dark' ? 'border-[#383838] bg-[#1f1f1f]' : 'border-[#e7e1d7] bg-[#fffdf9]'}`}>
              <div className="mb-7">
                <div className="mb-7 flex items-center gap-3">
                  <img src="/HSlogo.png" alt="Ruiru Rentals logo" className="h-12 w-12 rounded-xl border border-black/5 object-cover" />
                  <div>
                    <p className={`font-semibold ${theme === 'dark' ? 'text-white' : 'text-[#26332d]'}`}>Ruiru Rentals</p>
                    <p className={`text-xs ${theme === 'dark' ? 'text-slate-300' : 'text-gray-600'}`}>Property management</p>
                  </div>
                </div>
                <p className={`text-xs font-semibold uppercase tracking-[0.14em] ${theme === 'dark' ? 'text-emerald-300' : 'text-[#2f5542]'}`}>Welcome back</p>
                <h2 className={`mt-1 text-2xl font-semibold tracking-tight ${theme === 'dark' ? 'text-white' : 'text-[#26332d]'}`}>Sign in</h2>
                <p className={`mt-1 text-sm leading-5 ${theme === 'dark' ? 'text-slate-400' : 'text-slate-600'}`}>Use your authorized account to access the portal.</p>
              </div>

              {loginFeedback && (
              <p role="alert" className={`mb-5 flex items-start gap-2.5 rounded-xl border px-3.5 py-3 text-sm leading-5 ${theme === 'dark' ? 'border-rose-900/80 bg-rose-950/50 text-rose-300' : 'border-rose-200 bg-rose-50 text-rose-700'}`}>
                  <AlertCircle size={17} className="mt-0.5 shrink-0" />
                  <span>{loginFeedback}</span>
                </p>
              )}

              <form onSubmit={handleLoginSubmit} className="space-y-5">
                <div>
                  <label htmlFor="login-email" className={`mb-2 block text-sm font-semibold ${theme === 'dark' ? 'text-slate-300' : 'text-slate-700'}`}>Email address</label>
                  <input id="login-email" required type="email" autoComplete="username" value={email} onChange={e => setEmail(e.target.value)} placeholder="you@example.com" className={`w-full rounded-xl border px-4 py-3.5 text-sm outline-none transition placeholder:text-slate-500 focus:border-emerald-600 focus:ring-4 focus:ring-emerald-600/10 ${theme === 'dark' ? 'border-slate-700 bg-slate-950 text-white placeholder:text-slate-400' : 'border-slate-300 bg-white text-slate-900 placeholder:text-gray-500'}`} />
                </div>
                <div>
                  <div className="mb-2 flex items-center justify-between gap-3">
                    <label htmlFor="login-password" className={`block text-sm font-semibold ${theme === 'dark' ? 'text-slate-300' : 'text-slate-700'}`}>Password</label>
                    <button type="button" onClick={handleForgotPassword} className={`text-xs font-semibold transition ${theme === 'dark' ? 'text-emerald-400 hover:text-emerald-300' : 'text-emerald-700 hover:text-emerald-800'}`}>Forgot password?</button>
                  </div>
                  <div className="relative">
                    <input id="login-password" required type={showPassword ? 'text' : 'password'} autoComplete="current-password" value={password} onChange={e => setPassword(e.target.value)} placeholder="Enter your password" className={`w-full rounded-xl border px-4 py-3.5 pr-12 text-sm outline-none transition placeholder:text-slate-500 focus:border-emerald-600 focus:ring-4 focus:ring-emerald-600/10 ${theme === 'dark' ? 'border-slate-700 bg-slate-950 text-white placeholder:text-slate-400' : 'border-slate-300 bg-white text-slate-900 placeholder:text-gray-500'}`} />
                    <button type="button" aria-label={showPassword ? 'Hide password' : 'Show password'} aria-pressed={showPassword} onClick={() => setShowPassword(!showPassword)} className={`absolute right-2 top-1/2 -translate-y-1/2 rounded-lg p-2 transition ${theme === 'dark' ? 'text-slate-400 hover:bg-slate-800 hover:text-white' : 'text-slate-500 hover:bg-slate-100 hover:text-slate-900'}`}>
                      {showPassword ? <EyeOff size={18} /> : <Eye size={18} />}
                    </button>
                  </div>
                </div>
                <button type="submit" disabled={isProcessing || loginLockoutSeconds > 0} className={`flex w-full items-center justify-center gap-2 rounded-xl py-3.5 text-sm font-bold text-white shadow-sm transition focus-visible:outline-emerald-600 disabled:cursor-not-allowed disabled:opacity-50 ${theme === 'dark' ? 'bg-[#383838] hover:bg-[#505050]' : 'bg-slate-900 hover:bg-slate-800'}`}>
                  {isProcessing ? <div className="h-5 w-5 animate-spin rounded-full border-2 border-white border-t-transparent" /> : 'Sign in to your workspace'}
                </button>
              </form>

              <div className={`my-6 flex items-center gap-3 text-[11px] font-semibold uppercase tracking-[0.12em] ${theme === 'dark' ? 'text-slate-400' : 'text-slate-500'}`}>
                <span className={`h-px flex-1 ${theme === 'dark' ? 'bg-slate-800' : 'bg-slate-200'}`} />
                <span>Or use Google</span>
                <span className={`h-px flex-1 ${theme === 'dark' ? 'bg-slate-800' : 'bg-slate-200'}`} />
              </div>
              <button type="button" onClick={handleGoogleSignIn} disabled={isProcessing} className={`flex w-full items-center justify-center gap-3 rounded-xl border px-4 py-3.5 text-sm font-semibold transition disabled:cursor-not-allowed disabled:opacity-50 ${theme === 'dark' ? 'border-slate-700 text-slate-200 hover:bg-slate-800' : 'border-slate-300 text-slate-700 hover:bg-slate-50'}`}>
                <svg className="h-5 w-5 shrink-0" viewBox="0 0 24 24" aria-hidden="true">
                  <path fill="#4285F4" d="M21.35 11.1H12v2.7h5.38a5.4 5.4 0 0 1-2.04 3.1v2.58h3.3c1.93-1.78 3.04-4.4 3.04-7.48 0-.38-.12-.76-.33-1.1Z" />
                  <path fill="#34A853" d="M12 20.9c2.43 0 4.47-.8 5.96-2.18l-3.3-2.58c-.92.62-2.1.98-3.6.98-2.77 0-5.11-1.87-5.95-4.38H1.67v2.67C3.15 18.3 7.27 20.9 12 20.9Z" />
                  <path fill="#FBBC05" d="M6.05 12.74a5.27 5.27 0 0 1 0-3.48V6.59H1.67a8.91 8.91 0 0 0 0 8.82l4.38-2.67Z" />
                  <path fill="#EA4335" d="M12 5.18c1.32 0 2.5.45 3.44 1.35l2.58-2.58C16.46 2.51 14.43 1.7 12 1.7c-4.73 0-8.85 2.6-10.33 6.41l4.38 2.67C6.89 7.05 9.23 5.18 12 5.18Z" />
                </svg>
                Continue with Google
              </button>
            </div>
            <p className={`mt-5 text-center text-xs ${theme === 'dark' ? 'text-slate-400' : 'text-slate-600'}`}><span className="inline-flex items-center gap-1.5"><ShieldCheck size={14} />Secure sign-in for authorized users</span></p>
            <p className="mt-2 text-center"><PortfolioLink theme={theme}>@Gikunjucreates</PortfolioLink></p>
          </div>
        </section>
      </main>
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
              <p className="text-[10px] font-bold text-gray-500 uppercase tracking-wider">{isLandlord ? 'Super Admin' : 'Manager'}</p>
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

          {syncIssues.length > 0 && (
            <div className={`mb-6 flex items-start gap-3 rounded-xl border px-4 py-3 text-sm ${theme === 'dark' ? 'border-amber-400/20 bg-amber-400/10 text-amber-200' : 'border-amber-200 bg-amber-50 text-amber-900'}`} role="alert">
              <AlertCircle size={18} className="mt-0.5 shrink-0" aria-hidden="true" />
              <div className="min-w-0 flex-1">
                <p className="font-semibold">Some workspace data needs attention</p>
                <p className="mt-1 text-xs opacity-80">{syncIssues.map(issue => issue.message).join(' ')}</p>
              </div>
              <button type="button" onClick={() => window.location.reload()} className="shrink-0 rounded-lg px-2.5 py-1 text-xs font-semibold underline underline-offset-2 hover:no-underline">
                Retry
              </button>
            </div>
          )}

          <div key={activeTab} className="flex-1 tab-panel-enter">
            {activeTab === 'dashboard' && isLandlord && (
              <div className="space-y-6 animate-in fade-in duration-500">
                <div className="flex flex-col justify-between gap-3 sm:flex-row sm:items-center">
                  <h2 className={`text-2xl font-bold ${theme === 'dark' ? 'text-white' : 'text-gray-900'}`}>Landlord Finance Overview</h2>
                  <label className="flex items-center gap-2 text-sm font-semibold text-gray-500">
                    <span>Viewing:</span>
                    <select value={selectedDashboardCycleId === 'ACTIVE' && !activeCycle ? 'NONE' : selectedDashboardCycleId} onChange={e => setSelectedDashboardCycleId(e.target.value)} className={`max-w-52 rounded-lg border px-3 py-2 text-sm font-bold outline-none ${theme === 'dark' ? 'border-slate-700 bg-slate-900 text-white' : 'border-[#DCD4C6] bg-white text-gray-800'}`}>
                      {activeCycle ? <option value="ACTIVE">{activeCycle.month} · Active</option> : <option value="NONE">No open cycle</option>}
                      {billingCycles.filter(cycle => cycle.status === 'CLOSED').map(cycle => <option key={cycle.id} value={cycle.id}>{cycle.month} · Closed</option>)}
                    </select>
                  </label>
                </div>

                <section className={`rounded-2xl border p-5 md:p-6 ${theme === 'dark' ? 'border-slate-800 bg-slate-900' : 'border-[#E8DFCE] bg-[#F4EFE6]'}`}>
                  <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
                    <div>
                      <p className="text-xs font-black uppercase tracking-widest text-gray-500">Billing Cycles</p>
                      <h3 className={`mt-1 text-xl font-bold ${theme === 'dark' ? 'text-white' : 'text-gray-900'}`}>
                        {viewedCycle ? <>{viewedCycle.month} <span className={viewedCycle.status === 'OPEN' ? 'text-emerald-600' : 'text-gray-500'}>— {viewedCycle.status}</span></> : 'No billing cycle selected'}
                      </h3>
                      {isHistoricalCycleView && <p className="mt-1 text-xs font-medium text-gray-500">Past month · edit billed amounts and record missing payments below.</p>}
                      {!activeCycle && <p className="mt-1 text-sm text-gray-500">Open the first month to start cycle based billing.</p>}
                    </div>
                    <div className="flex flex-wrap gap-2">
                      <button type="button" onClick={() => { setModalError(''); setIsCycleModalOpen(true); }} disabled={isProcessing} className="rounded-xl bg-gray-800 px-4 py-2.5 text-sm font-bold text-white transition hover:bg-gray-900 disabled:opacity-50">Open New Month</button>
                      <button type="button" onClick={() => { setModalError(''); setIsBackfillCycleModalOpen(true); }} disabled={isProcessing} className={`rounded-xl border px-4 py-2.5 text-sm font-semibold transition disabled:opacity-50 ${theme === 'dark' ? 'border-[#505050] text-slate-200 hover:bg-[#292929]' : 'border-[#d8d2c8] text-[#34483b] hover:bg-white'}`}>Add Past Month</button>
                      <button type="button" onClick={() => setConfirmationAction({ type: 'closeCycle' })} disabled={!activeCycle || isProcessing} className={`rounded-xl border px-4 py-2.5 text-sm font-bold transition disabled:opacity-40 ${theme === 'dark' ? 'border-slate-700 text-slate-200 hover:bg-slate-800' : 'border-gray-300 text-gray-700 hover:bg-white'}`}>Close Current Month</button>
                    </div>
                  </div>
                  {billingCycleHistory.length > 0 && (
                    <div className={`mt-5 border-t pt-4 ${theme === 'dark' ? 'border-slate-800' : 'border-[#DCD4C6]'}`}>
                      <h4 className="mb-3 text-xs font-black uppercase tracking-widest text-gray-500">Monthly History</h4>
                      <div className="space-y-2">
                        {billingCycleHistory.map(cycle => (
                          <button key={cycle.id} type="button" onClick={() => setSelectedDashboardCycleId(cycle.id)} className={`flex w-full flex-col gap-2 rounded-xl border p-3 text-left transition sm:flex-row sm:items-center sm:justify-between ${viewedCycle?.id === cycle.id ? (theme === 'dark' ? 'border-emerald-700 bg-emerald-950/20' : 'border-emerald-300 bg-emerald-50') : (theme === 'dark' ? 'border-slate-800 hover:bg-slate-950' : 'border-[#E8DFCE] hover:bg-white')}`}>
                            <span className={`font-bold ${theme === 'dark' ? 'text-white' : 'text-gray-900'}`}>{cycle.month}</span>
                            <span className="flex flex-wrap gap-x-4 gap-y-1 text-xs font-semibold text-gray-500">
                              <span>Rent {formatKes(cycle.rentCollected)}</span>
                              <span>Water {formatKes(cycle.waterCollected)}</span>
                              <span className="text-emerald-600">{cycle.clearedCount} cleared</span>
                              <span className="text-rose-600">{cycle.arrearsCount} arrears</span>
                            </span>
                          </button>
                        ))}
                      </div>
                    </div>
                  )}
                </section>

                {isHistoricalCycleView && viewedCycle?.status === 'CLOSED' && (
                  <section className={`overflow-hidden rounded-2xl border ${theme === 'dark' ? 'border-[#383838] bg-[#1c1c1c]' : 'border-[#e7e1d7] bg-[#fffdf9]'}`}>
                    <div className="border-b border-inherit p-5">
                      <h3 className={`font-semibold ${theme === 'dark' ? 'text-white' : 'text-[#26332d]'}`}>{viewedCycle.month} tenant bills</h3>
                      <p className="mt-1 text-sm text-gray-500">Set the correct rent and water charges, then record any payments that were missed.</p>
                    </div>
                    <div className="overflow-x-auto">
                      <table className="w-full text-left text-sm">
                        <thead className={theme === 'dark' ? 'bg-[#242424] text-gray-400' : 'bg-[#f1eee7] text-gray-500'}>
                          <tr><th className="p-3">Tenant</th><th className="p-3">Unit</th><th className="p-3">Rent billed</th><th className="p-3">Water billed</th><th className="p-3">Paid</th><th className="p-3">Actions</th></tr>
                        </thead>
                        <tbody className="divide-y divide-inherit">
                          {viewedCycleTenantCycles.length === 0 && <tr><td colSpan="6" className="p-7 text-center text-gray-500">No tenant bills were found for this month.</td></tr>}
                          {viewedCycleTenantCycles.map(cycleTenant => {
                            const tenant = tenants.find(record => record.id === cycleTenant.tenantId);
                            const house = houses.find(record => record.id === cycleTenant.houseId);
                            return <tr key={cycleTenant.id}>
                              <td className="p-3 font-medium">{cycleTenant.tenantName}</td>
                              <td className="p-3 text-gray-500">{house?.name || cycleTenant.houseId || '—'}</td>
                              <td className="p-3">{formatKes(cycleTenant.expectedRent)}</td>
                              <td className="p-3">{formatKes(cycleTenant.expectedWater)}</td>
                              <td className="p-3">{formatKes(Number(cycleTenant.paidRent || 0) + Number(cycleTenant.paidWater || 0))}</td>
                              <td className="p-3"><div className="flex flex-wrap gap-2">
                                <button type="button" onClick={() => { setModalError(''); setSelectedTenantCycleForEdit(cycleTenant); setIsCycleChargeModalOpen(true); }} disabled={isProcessing} className={`rounded-lg border px-3 py-1.5 text-xs font-semibold ${theme === 'dark' ? 'border-[#505050] hover:bg-[#292929]' : 'border-[#d8d2c8] text-[#34483b] hover:bg-[#f6f4ef]'}`}>Edit bills</button>
                                {tenant && <button type="button" onClick={() => { setModalError(''); setSelectedTenant(tenant); setSelectedPaymentCycleId(viewedCycle.id); setIsPaymentModalOpen(true); }} disabled={isProcessing} className="rounded-lg bg-[#2f5542] px-3 py-1.5 text-xs font-semibold text-white hover:bg-[#244433]">Log payment</button>}
                              </div></td>
                            </tr>;
                          })}
                        </tbody>
                      </table>
                    </div>
                  </section>
                )}
                
                {cycleStats.waterReserve < 0 ? (
                  <div className="bg-rose-500/10 border border-rose-500/30 p-4 rounded-xl flex items-center gap-4 animate-pulse">
                    <div className="bg-rose-500/20 p-3 rounded-full text-rose-500"><AlertCircle size={24}/></div>
                    <div className="flex-1">
                      <h4 className="text-rose-500 font-bold">Deficit Alert: RUJWASCO Bill Settle Needed</h4>
                      <p className={`text-sm ${theme === 'dark' ? 'text-rose-400' : 'text-rose-700'}`}>
                        Collected water payments from tenants total <strong className="font-mono">{formatKes(cycleStats.collectedWaterRev)}</strong>.
                        This is short by <strong className={`font-mono text-lg ${theme === 'dark' ? 'text-rose-500' : 'text-rose-600'}`}>{formatKes(Math.abs(cycleStats.waterReserve))}</strong> to settle the logged invoices of <strong className="font-mono">{formatKes(cycleStats.totalMasterWaterBills)}</strong>.
                      </p>
                    </div>
                  </div>
                ) : stats.totalWaterBillsSinceReset > 0 ? (
                  <div className="bg-emerald-500/10 border border-emerald-500/30 p-4 rounded-xl flex items-center gap-4">
                    <div className={`bg-emerald-500/20 p-3 rounded-full ${theme === 'dark' ? 'text-emerald-500' : 'text-emerald-600'}`}><BellRing size={24}/></div>
                    <div className="flex-1">
                      <h4 className={`font-bold ${theme === 'dark' ? 'text-emerald-400' : 'text-emerald-700'}`}>Water Settle Target Met!</h4>
                      <p className={`text-sm ${theme === 'dark' ? 'text-emerald-500' : 'text-emerald-800'}`}>
                        The needed water bills of <strong className="font-mono">{formatKes(stats.totalWaterBillsSinceReset)}</strong> are fully accumulated inside the vault!
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
                        Accumulated water payments inside vault: <strong className="font-mono">{formatKes(cycleStats.collectedWaterRev)}</strong>. Log a master provider bill to evaluate balance limits.
                      </p>
                    </div>
                  </div>
                )}

                <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
                  <div className={`p-6 rounded-2xl border shadow-sm transition-all duration-300 hover:-translate-y-1 hover:shadow-lg ${theme === 'dark' ? 'bg-emerald-950/20 border-emerald-800' : 'bg-emerald-50/50 border-emerald-200'}`}>
                    <p className={`text-sm font-bold mb-1 ${theme === 'dark' ? 'text-emerald-500' : 'text-emerald-700'}`}>Total Rent Collected</p>
                    <h3 className={`text-2xl font-extrabold ${theme === 'dark' ? 'text-emerald-400' : 'text-emerald-600'}`}>{formatKes(stats.collectedRentRev)}</h3>
                    <p className={`text-[10px] mt-1 font-bold ${theme === 'dark' ? 'text-emerald-500' : 'text-emerald-700'}`}>Total areas: {stats.totalUnits}</p>
                  </div>

                  <div className={`p-6 rounded-2xl border shadow-sm flex flex-col justify-between transition-all duration-300 hover:-translate-y-1 hover:shadow-lg ${theme === 'dark' ? 'bg-cyan-950/20 border-cyan-800' : 'bg-cyan-50/50 border-cyan-200'}`}>
                    <div>
                      <p className={`text-xs font-extrabold uppercase tracking-wide mb-1 flex items-center gap-1 ${theme === 'dark' ? 'text-cyan-400' : 'text-cyan-600'}`}>
                        <Droplet size={14}/> Water Vault Total
                      </p>
                      <h3 className={`text-2xl font-extrabold ${theme === 'dark' ? 'text-cyan-300' : 'text-cyan-500'}`}>{formatKes(cycleStats.collectedWaterRev)}</h3>
                    </div>
                    <div className={`mt-3 pt-3 border-t ${theme === 'dark' ? 'border-cyan-900/40' : 'border-cyan-200'}`}>
                      <div className="grid grid-cols-2 gap-2">
                        <button onClick={() => { setModalError(''); setIsWaterBillModalOpen(true); }} className={`w-full text-white text-[10px] font-bold py-2 rounded-lg transition ${theme === 'dark' ? 'bg-cyan-600 hover:bg-cyan-700' : 'bg-cyan-700 hover:bg-cyan-800'}`}>
                          Log Invoice
                        </button>
                        <button onClick={handleResetWaterVault} disabled={isProcessing} className={`w-full text-[10px] font-bold py-2 rounded-lg border transition disabled:opacity-50 flex items-center justify-center gap-1 ${theme === 'dark' ? 'text-cyan-200 border-cyan-700 hover:bg-cyan-900/40' : 'text-cyan-800 border-cyan-300 hover:bg-cyan-100'}`}>
                          <RotateCcw size={12}/> Reset Vault
                        </button>
                      </div>
                    </div>
                  </div>

                  <div className={`p-6 rounded-2xl border shadow-sm flex flex-col justify-between transition-all duration-300 hover:-translate-y-1 hover:shadow-lg ${theme === 'dark' ? 'bg-rose-950/20 border-rose-800' : 'bg-rose-50/50 border-rose-200'}`}>
                    <div>
                      <p className={`text-xs font-extrabold uppercase tracking-wide mb-1 flex items-center gap-1 ${theme === 'dark' ? 'text-rose-400' : 'text-rose-600'}`}>
                        <AlertCircle size={14}/> Total Operations Exp.
                      </p>
                      <h3 className={`text-2xl font-extrabold ${theme === 'dark' ? 'text-rose-400' : 'text-rose-600'}`}>{formatKes(cycleStats.totalOperatingExpenses)}</h3>
                    </div>
                    <div className={`mt-3 pt-3 border-t text-[10px] font-bold space-y-0.5 ${theme === 'dark' ? 'border-rose-900/40 text-rose-400' : 'border-rose-200 text-rose-600'}`}>
                      <p>Repairs: {formatKes(cycleStats.totalRepairExpenses)}</p>
                      <p>Septic Removals: {formatKes(cycleStats.totalSepticExpenses)}</p>
                    </div>
                  </div>

                  <div className={`p-6 rounded-2xl border shadow-sm transition-all duration-300 hover:-translate-y-1 hover:shadow-lg ${theme === 'dark' ? 'bg-gray-900/50 border-gray-800' : 'bg-[#E8DFCE]/50 border-[#DCD4C6]'}`}>
                    <p className={`text-xs font-extrabold uppercase tracking-wide mb-1 flex items-center gap-1 ${theme === 'dark' ? 'text-gray-400' : 'text-gray-600'}`}>
                      <Coins size={14}/> Joseph's Tip Pool
                    </p>
                    <h3 className={`text-2xl font-black font-mono ${theme === 'dark' ? 'text-gray-200' : 'text-gray-900'}`}>{formatKes(cycleStats.totalJosephBonus)}</h3>
                    <p className="text-[10px] text-gray-500 font-bold mt-1">This cycle from excess payments</p>
                  </div>
                </div>

                <section className={`rounded-2xl border p-5 ${theme === 'dark' ? 'border-slate-800 bg-slate-900/60' : 'border-[#E8DFCE] bg-white/70'}`}>
                  <h3 className={`mb-4 text-sm font-black uppercase tracking-widest ${theme === 'dark' ? 'text-slate-300' : 'text-gray-600'}`}>All-Time Summary</h3>
                  <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
                    <div><p className="text-xs font-semibold text-gray-500">Rent collected</p><p className={`mt-1 font-mono text-lg font-black ${theme === 'dark' ? 'text-white' : 'text-gray-900'}`}>{formatKes(stats.collectedRentRev)}</p></div>
                    <div><p className="text-xs font-semibold text-gray-500">Water collected</p><p className={`mt-1 font-mono text-lg font-black ${theme === 'dark' ? 'text-white' : 'text-gray-900'}`}>{formatKes(stats.collectedWaterRev)}</p></div>
                    <div><p className="text-xs font-semibold text-gray-500">Operations expenses</p><p className={`mt-1 font-mono text-lg font-black ${theme === 'dark' ? 'text-white' : 'text-gray-900'}`}>{formatKes(stats.totalOperatingExpenses)}</p></div>
                    <div><p className="text-xs font-semibold text-gray-500">Excess payments</p><p className={`mt-1 font-mono text-lg font-black ${theme === 'dark' ? 'text-white' : 'text-gray-900'}`}>{formatKes(stats.totalJosephBonus)}</p></div>
                  </div>
                </section>

                <div className={`rounded-2xl border p-6 shadow-sm ${theme === 'dark' ? 'bg-slate-900 border-slate-800' : 'bg-[#F4EFE6] border-[#E8DFCE]'}`}>
                  <h3 className={`text-lg font-bold mb-4 ${theme === 'dark' ? 'text-white' : 'text-gray-900'}`}>Pending Verifications</h3>
                  <p className="text-sm text-gray-500 mb-4 font-medium">Logged by Manager; needs Super Admin confirmation.</p>
                  {cyclePayments.filter(p => p.status === 'PENDING').length === 0 ? (
                    <p className={`text-sm font-bold p-4 rounded-xl flex items-center gap-2 ${theme === 'dark' ? 'bg-emerald-500/10 text-emerald-400' : 'bg-emerald-500/10 text-emerald-600'}`}>
                      <CheckCircle2 size={18}/> All payments verified and up to date.
                    </p>
                  ) : (
                    <div className="space-y-3">
                      {cyclePayments.filter(p => p.status === 'PENDING').map(p => (
                        <form key={p.id} onSubmit={event => { event.preventDefault(); handleConfirmPayment(p, new FormData(event.currentTarget).get('messageCode')); }} className={`flex flex-col sm:flex-row sm:items-center justify-between p-4 rounded-xl border gap-4 transition-all hover:shadow-md ${theme === 'dark' ? 'bg-slate-950 border-slate-800' : 'bg-[#FDFBF7] border-[#E8DFCE]'}`}>
                          <div>
                            <p className={`font-bold text-lg ${theme === 'dark' ? 'text-white' : 'text-gray-900'}`}>{p.tenantName}</p>
                            <p className="text-xs text-gray-500 font-semibold">{p.type === 'COMBINED' ? 'Rent & Water Combined' : p.type} via {p.method}</p>
                          </div>
                          <div className="flex flex-col sm:flex-row sm:items-center justify-between sm:justify-end gap-3">
                            <span className={`font-black text-xl ${theme === 'dark' ? 'text-white' : 'text-gray-900'}`}>{formatKes(p.amount)}</span>
                            <input required name="messageCode" defaultValue={p.messageCode || ''} aria-label={`Reference code for ${p.tenantName}`} type="text" placeholder="Transaction reference" className={`w-full sm:w-48 border rounded-lg px-3 py-2 text-xs font-mono uppercase outline-none focus:ring-2 focus:ring-gray-500 ${theme === 'dark' ? 'bg-slate-900 border-slate-700 text-white' : 'bg-white border-[#DCD4C6] text-gray-900'}`} />
                            <button type="submit" disabled={isProcessing || isHistoricalCycleView} className="bg-gray-800 hover:bg-gray-900 text-white px-5 py-2.5 rounded-xl text-sm font-bold transition-all disabled:bg-gray-400 flex items-center gap-2">
                              {isProcessing ? 'Processing...' : 'Confirm'}
                            </button>
                          </div>
                        </form>
                      ))}
                    </div>
                  )}
                </div>

                <section className="rounded-2xl border border-rose-500/40 p-5">
                  <p className="text-xs font-black uppercase tracking-widest text-rose-600">Danger Zone</p>
                  <p className={`mt-1 text-sm ${theme === 'dark' ? 'text-slate-400' : 'text-gray-600'}`}>Remove operational logs and reset tenant paid totals.</p>
                  <button type="button" onClick={() => setConfirmationAction({ type: 'resetData' })} disabled={isProcessing} className="mt-4 rounded-xl border border-rose-500 px-4 py-2.5 text-sm font-bold text-rose-600 transition hover:bg-rose-600 hover:text-white disabled:opacity-50">Reset Payment & Operations Data</button>
                </section>
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
                  {canManageProperties && (
                    <button onClick={() => { setModalError(''); setSelectedHouseForEdit(null); setIsHouseModalOpen(true); }} className="bg-gray-800 hover:bg-gray-900 text-white px-5 py-2.5 rounded-xl text-sm font-bold flex items-center gap-2 shadow-sm transition-all hover:shadow-md hover:-translate-y-0.5">
                      <Plus size={18}/> Add Unit
                    </button>
                  )}
                </div>

                <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-5">
                  {houses.length === 0 && <p className="text-gray-500 font-medium">No houses registered yet.</p>}
                  {sortedHouses.map(house => {
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
                        
                        {(isLandlord || (canManageProperties && !isOccupied)) && (
                          <div className={`ml-2 mt-4 pt-4 border-t ${theme === 'dark' ? 'border-white/10' : 'border-black/5'}`}>
                            <div className="flex flex-col gap-2">
                              {isLandlord && <button type="button" onClick={() => { setSelectedHouseForEdit(house); setModalError(''); setIsHouseModalOpen(true); }} disabled={isProcessing} className={`w-full rounded-xl border px-3 py-2.5 text-xs font-semibold transition disabled:cursor-not-allowed disabled:opacity-80 ${theme === 'dark' ? 'border-[#505050] bg-[#1c1c1c] text-slate-100 hover:bg-[#292929]' : 'border-[#b8b1a5] bg-[#fffdf9] text-[#26332d] hover:bg-[#f4f1ea]'}`}><span className="inline-flex items-center justify-center gap-2"><Edit size={15}/> Edit unit details</span></button>}
                              {canManageProperties && !isOccupied && <button
                                onClick={() => handleToggleHouseRepairMode(house)}
                                disabled={isProcessing}
                                className={`w-full text-xs font-bold py-2.5 rounded-xl transition-all disabled:opacity-50 flex items-center justify-center gap-2 ${isUnderRepair ? 'bg-emerald-600 hover:bg-emerald-700 text-white' : 'bg-gray-800 hover:bg-gray-900 text-white'}`}>
                                {isUnderRepair ? <><CheckCircle2 size={16}/> Mark as Ready & Vacant</> : <><Wrench size={16}/> Set to Under Repair</>}
                              </button>}
                            </div>
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
                  {(role === ROLES.LANDLORD || role === ROLES.MANAGER) && (
                    <button onClick={() => { setModalError(''); setNewTenantHouseId(''); setIsTenantModalOpen(true); }} className="bg-gray-800 hover:bg-gray-900 text-white px-5 py-2.5 rounded-xl text-sm font-bold flex items-center gap-2 shadow-sm transition-all hover:shadow-md hover:-translate-y-0.5">
                      <Plus size={18}/> {role === ROLES.MANAGER ? 'Request New Tenant' : 'Register Tenant'}
                    </button>
                  )}
                </div>

                {(isLandlord || visibleTenantChangeRequests.length > 0) && (
                  <section className={`rounded-2xl border p-5 shadow-sm ${theme === 'dark' ? 'border-slate-800 bg-slate-900' : 'border-[#E8DFCE] bg-[#FDFBF7]'}`} aria-labelledby="tenant-requests-title">
                    <div className="mb-4 flex flex-wrap items-center justify-between gap-2">
                      <div>
                        <h3 id="tenant-requests-title" className={`text-lg font-bold ${theme === 'dark' ? 'text-white' : 'text-gray-900'}`}>{isLandlord ? 'Tenant Approval Requests' : 'My Tenant Requests'}</h3>
                        <p className="mt-1 text-sm text-gray-500">{isLandlord ? 'Review manager requests. Approved additions and removals take effect immediately.' : 'New tenants and removal requests stay pending until the landlord reviews them.'}</p>
                      </div>
                    </div>
                    {visibleTenantChangeRequests.length === 0 ? (
                      <p className="rounded-xl border border-dashed border-[#DCD4C6] p-5 text-center text-sm text-gray-500 dark:border-slate-700">No tenant requests are waiting for review.</p>
                    ) : (
                      <div className="grid grid-cols-1 gap-3 lg:grid-cols-2">
                        {visibleTenantChangeRequests.map(request => {
                          const requestHouse = houses.find(house => house.id === request.houseId);
                          const isCreateRequest = request.action === 'CREATE_TENANT';
                          return (
                            <article key={request.id} className={`rounded-xl border p-4 ${theme === 'dark' ? 'border-slate-700 bg-[#151515]' : 'border-[#E8DFCE] bg-white'}`}>
                              <div className="flex flex-wrap items-start justify-between gap-3">
                                <div>
                                  <p className={`font-bold ${theme === 'dark' ? 'text-white' : 'text-gray-900'}`}>{request.tenantName}</p>
                                  <p className="mt-1 text-sm text-gray-500">{isCreateRequest ? 'New tenant registration' : 'Tenant removal'} · {requestHouse?.name || 'Unit unavailable'}</p>
                                  {isCreateRequest && <p className="mt-1 text-xs text-gray-500">{request.phone || 'No phone'} · {formatKes(requestHouse?.rent || 0)} monthly rent</p>}
                                  <p className="mt-1 text-xs text-gray-500">Requested by {request.requestedByName || 'Manager'} · {request.requestedAt ? new Date(request.requestedAt).toLocaleDateString('en-KE', { timeZone: DEFAULT_TIMEZONE }) : '—'}</p>
                                </div>
                                {!isLandlord && (
                                  <span className={`rounded-full px-2.5 py-1 text-xs font-bold ${request.status === 'APPROVED' ? 'bg-emerald-100 text-emerald-800 dark:bg-emerald-900/40 dark:text-emerald-300' : request.status === 'REJECTED' ? 'bg-rose-100 text-rose-800 dark:bg-rose-900/40 dark:text-rose-300' : 'bg-amber-100 text-amber-800 dark:bg-amber-900/40 dark:text-amber-300'}`}>{request.status === 'APPROVED' ? 'Approved' : request.status === 'REJECTED' ? 'Declined' : 'Pending landlord approval'}</span>
                                )}
                              </div>
                              {isLandlord && (
                                <div className="mt-4 flex flex-wrap justify-end gap-2 border-t border-[#E8DFCE] pt-3 dark:border-slate-700">
                                  <button type="button" disabled={isProcessing} onClick={() => handleReviewTenantChangeRequest(request, 'REJECTED')} className={`rounded-lg border px-3 py-2 text-sm font-semibold disabled:opacity-50 ${theme === 'dark' ? 'border-slate-600 text-slate-200 hover:bg-white/5' : 'border-[#DCD4C6] text-gray-700 hover:bg-gray-50'}`}>Decline</button>
                                  <button type="button" disabled={isProcessing} onClick={() => handleReviewTenantChangeRequest(request, 'APPROVED')} className="rounded-lg bg-gray-800 px-3 py-2 text-sm font-semibold text-white hover:bg-gray-900 disabled:opacity-50">{isCreateRequest ? 'Approve registration' : 'Approve removal'}</button>
                                </div>
                              )}
                            </article>
                          );
                        })}
                      </div>
                    )}
                  </section>
                )}

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
                      {sortedTenants.map(tenant => {
                        const house = houses.find(h => h.id === tenant.houseId);
                        const cycle = activeTenantCycles.get(tenant.id);
                        const rentDue = cycle
                          ? Number(cycle.expectedRent || 0) - Number(cycle.paidRent || 0)
                          : Number(tenant.expectedRent || 0) - Number(tenant.paidRent || 0);
                        const waterDue = cycle
                          ? Number(cycle.expectedWater || 0) - Number(cycle.paidWater || 0)
                          : Number(tenant.expectedWater || 0) - Number(tenant.paidWater || 0);
                        const owesMoney = rentDue > 0 || waterDue > 0;
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
                <div className="flex flex-col gap-2 sm:flex-row sm:items-end sm:justify-between">
                  <div className="flex items-start gap-3">
                    <button type="button" onClick={() => setActiveTab('dashboard')} aria-label="Back to dashboard" className={`mt-0.5 inline-flex shrink-0 items-center gap-2 rounded-lg border px-3 py-2 text-sm font-semibold transition-colors ${theme === 'dark' ? 'border-[#505050] text-slate-200 hover:bg-[#292929]' : 'border-[#d8d2c8] text-[#34483b] hover:bg-white'}`}>
                      <ArrowLeft size={16} aria-hidden="true" /> Back
                    </button>
                    <div>
                      <h2 className={`text-2xl font-bold ${theme === 'dark' ? 'text-white' : 'text-gray-900'}`}>Billing & Payments</h2>
                      <p className="mt-1 text-sm font-medium text-gray-500">{activeCycle ? `Balances for ${activeCycle.month}` : 'No billing cycle is currently open.'}</p>
                    </div>
                  </div>
                </div>

                <div>
                  <div className="mb-4 flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
                    <h3 className="text-lg font-bold font-mono uppercase tracking-wider text-gray-500">Tenant Billing Profiles</h3>
                    <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
                      <label className="sr-only" htmlFor="tenant-billing-search">Search tenants</label>
                      <input id="tenant-billing-search" value={tenantSearch} onChange={e => setTenantSearch(e.target.value)} placeholder="Search tenant name" className={`min-w-0 rounded-xl border px-3 py-2 text-sm outline-none focus:border-emerald-500 ${theme === 'dark' ? 'border-slate-700 bg-slate-900 text-white placeholder:text-slate-500' : 'border-[#DCD4C6] bg-white text-gray-900'}`} />
                      <label className="sr-only" htmlFor="tenant-billing-status">Filter tenants by balance</label>
                      <select id="tenant-billing-status" value={tenantStatusFilter} onChange={e => setTenantStatusFilter(e.target.value)} className={`rounded-xl border px-3 py-2 text-sm font-semibold outline-none ${theme === 'dark' ? 'border-slate-700 bg-slate-900 text-white' : 'border-[#DCD4C6] bg-white text-gray-900'}`}>
                        <option value="ALL">All Tenants</option>
                        <option value="ARREARS">Has Arrears</option>
                        <option value="CLEARED">Fully Cleared</option>
                      </select>
                    </div>
                  </div>
                  <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
                    {sortedBillingTenants.map(tenant => {
                      const house = houses.find(h => h.id === tenant.houseId);
                      const cycleTenant = activeTenantCycles.get(tenant.id);
                      const rentBal = Number(cycleTenant?.expectedRent || 0) - Number(cycleTenant?.paidRent || 0);
                      const waterBal = Number(cycleTenant?.expectedWater || 0) - Number(cycleTenant?.paidWater || 0);
                      const tenantRepairs = repairs.filter(r => r.houseId === tenant.houseId && r.status === 'OPEN');
                      const pendingPayments = activeCycle ? payments.filter(p => p.tenantId === tenant.id && p.status === 'PENDING' && p.cycleId === activeCycle.id) : [];

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
                              <form key={pendingPayment.id} onSubmit={event => { event.preventDefault(); handleConfirmPayment(pendingPayment, new FormData(event.currentTarget).get('messageCode')); }} className="mb-4 bg-amber-500/10 border border-amber-500/20 p-3.5 rounded-xl shadow-sm">
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
                                {canApproveRent && (
                                  <>
                                    <label className={`block mt-3 mb-1 text-[10px] font-bold uppercase tracking-wider ${theme === 'dark' ? 'text-amber-300' : 'text-amber-800'}`} htmlFor={`pending-reference-${pendingPayment.id}`}>Transaction reference required to confirm</label>
                                    <input id={`pending-reference-${pendingPayment.id}`} required name="messageCode" defaultValue={pendingPayment.messageCode || ''} type="text" placeholder="Enter reference code" className={`w-full border rounded-lg px-3 py-2 text-xs font-mono uppercase outline-none focus:ring-2 focus:ring-amber-500 ${theme === 'dark' ? 'bg-slate-950 border-slate-700 text-white' : 'bg-white border-amber-200 text-gray-900'}`} />
                                    <button type="submit" disabled={isProcessing || !activeCycle || pendingPayment.cycleId !== activeCycle.id} className="w-full mt-3 bg-amber-600 hover:bg-amber-700 text-white font-bold text-xs py-2 rounded-lg transition-all disabled:opacity-50 shadow-sm">
                                      {isProcessing ? 'Processing...' : 'Confirm & Update Balances'}
                                    </button>
                                  </>
                                )}
                              </form>
                            ))}
                          </div>

                          <div className={`flex flex-col gap-2.5 mt-4 pt-3 border-t ${theme === 'dark' ? 'border-slate-800' : 'border-[#DCD4C6]'}`}>
                            <div className="flex gap-2.5">
                              <button onClick={() => { setModalError(''); setSelectedTenant(tenant); setSelectedPaymentCycleId(activeCycle?.id || ''); setIsPaymentModalOpen(true); }} disabled={!activeCycle || !cycleTenant || isProcessing || !canRecordRent} className="flex-1 bg-gray-800 hover:bg-gray-900 text-white text-xs font-bold py-2.5 rounded-xl transition-all shadow-sm text-center disabled:cursor-not-allowed disabled:opacity-40">Log Payment</button>
                              {hasPermission(role, PERMISSIONS.RECORD_RENT) && (
                                <button onClick={() => { setModalError(''); setSelectedTenant(tenant); setIsBillingModalOpen(true); }} disabled={!activeCycle || !cycleTenant || isProcessing} className={`flex-1 text-xs font-bold py-2.5 rounded-xl transition-all shadow-sm text-center border disabled:cursor-not-allowed disabled:opacity-40 ${theme === 'dark' ? 'bg-slate-800 hover:bg-slate-700 text-slate-200 border-slate-700' : 'bg-white hover:bg-gray-50 text-gray-800 border-gray-200'}`}>Set Water Share</button>
                              )}
                            </div>
                            {canApproveRent && (
                              <button onClick={() => { setSelectedTenant(tenant); setIsHistoryModalOpen(true); }} className={`w-full text-xs font-bold py-2.5 rounded-xl transition flex items-center justify-center gap-1.5 border ${theme === 'dark' ? 'bg-slate-800 hover:bg-slate-700 text-slate-200 border-slate-700' : 'bg-[#FDFBF7] hover:bg-white text-gray-700 border-[#DCD4C6]'}`}>
                                <ListOrdered size={16}/> View Verified History
                              </button>
                            )}
                          </div>
                        </div>
                      )
                    })}
                    {sortedBillingTenants.length === 0 && <p className="col-span-full rounded-xl border border-dashed border-gray-300 p-8 text-center text-sm font-medium text-gray-500">{activeTenants.length === 0 ? 'No active tenants registered.' : 'No tenants match the current search and filter.'}</p>}
                  </div>
                </div>

                <div>
                  <div className="mb-4 flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
                    <div>
                      <h3 className="text-lg font-bold font-mono uppercase tracking-wider text-gray-500">Payment Ledger</h3>
                      <p className="mt-1 text-xs font-semibold text-gray-500">Showing {filteredPayments.length} of {payments.length} payments</p>
                    </div>
                    <div className="flex flex-wrap gap-2">
                      <label className="sr-only" htmlFor="payment-ledger-month">Filter ledger by month</label>
                      <select id="payment-ledger-month" value={paymentMonthFilter} onChange={e => setPaymentMonthFilter(e.target.value)} className={`rounded-lg border px-3 py-2 text-xs font-bold outline-none ${theme === 'dark' ? 'border-slate-700 bg-slate-900 text-white' : 'border-[#DCD4C6] bg-white text-gray-800'}`}>
                        <option value={createCurrentMonthKey()}>{getMonthLabel(createCurrentMonthKey())}</option>
                        {ledgerMonths.filter(month => month !== createCurrentMonthKey()).map(month => <option key={month} value={month}>{getMonthLabel(month)}</option>)}
                        <option value="ALL">View All</option>
                      </select>
                      <button onClick={printLedgerReport} className="flex items-center gap-2 rounded-lg bg-gray-800 px-4 py-2 text-xs font-bold text-white shadow-sm transition hover:bg-gray-900">
                        <Download size={14} /> Download Ledger Report
                      </button>
                    </div>
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
                        {filteredPayments.length === 0 && (
                          <tr><td colSpan="7" className="p-8 text-center text-gray-500 font-medium">{payments.length === 0 ? 'No payments recorded.' : 'No payments in this month.'}</td></tr>
                        )}
                        {sortedPayments.map(payment => (
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
                <div className="flex flex-col sm:flex-row sm:items-end justify-between gap-3"><div><p className="text-sm text-gray-500">Water provider invoices and collection coverage.</p><h3 className={`text-xl font-semibold mt-1 ${theme === 'dark' ? 'text-white' : 'text-gray-900'}`}>Utilities</h3></div><div className="flex flex-wrap gap-2">{canRecordWater && <button onClick={() => { setModalError(''); setIsWaterBillModalOpen(true); }} disabled={isProcessing} className="rounded-lg bg-[#2f5542] px-4 py-2 text-sm font-semibold text-white hover:bg-[#244433] disabled:opacity-50">Log water bill</button>}{role === ROLES.LANDLORD && <button onClick={handleResetWaterVault} disabled={isProcessing} className={`px-4 py-2 rounded-lg text-sm font-semibold border flex items-center gap-2 disabled:opacity-50 ${theme === 'dark' ? 'border-[#505050] text-slate-200 hover:bg-[#292929]' : 'border-[#d8d2c8] text-[#34483b] hover:bg-white'}`}><RotateCcw size={15}/> Reset water vault</button>}</div></div>
                <div className="grid grid-cols-1 md:grid-cols-3 gap-3"><div className={`p-4 border rounded-lg ${theme === 'dark' ? 'bg-[#0A0A0A] border-[#262626]' : 'bg-white border-[#E5E5E5]'}`}><p className="text-xs text-gray-500">Tenant water collected</p><p className="text-2xl font-semibold mt-1">{formatKes(stats.collectedWaterRev)}</p></div><div className={`p-4 border rounded-lg ${theme === 'dark' ? 'bg-[#0A0A0A] border-[#262626]' : 'bg-white border-[#E5E5E5]'}`}><p className="text-xs text-gray-500">Provider bills this period</p><p className="text-2xl font-semibold mt-1">{formatKes(stats.totalWaterBillsSinceReset)}</p></div><div className={`p-4 border rounded-lg ${theme === 'dark' ? 'bg-[#0A0A0A] border-[#262626]' : 'bg-white border-[#E5E5E5]'}`}><p className="text-xs text-gray-500">Unallocated reserve</p><p className={`text-2xl font-semibold mt-1 ${stats.waterReserve < 0 ? 'text-rose-700 dark:text-rose-400' : 'text-emerald-700 dark:text-emerald-400'}`}>{formatKes(stats.waterReserve)}</p></div></div>
                <div className={`border rounded-lg overflow-hidden ${theme === 'dark' ? 'bg-[#1c1c1c] border-[#383838]' : 'bg-[#fffdf9] border-[#e7e1d7]'}`}><div className="p-4 border-b border-inherit flex items-center justify-between"><h3 className="font-semibold">Provider bills</h3>{canRecordWater && <button onClick={() => { setModalError(''); setIsWaterBillModalOpen(true); }} className="text-sm font-semibold text-[#2f5542] dark:text-slate-200">Log bill</button>}</div><div className="overflow-x-auto"><table className="w-full text-left text-sm"><thead className={`${theme === 'dark' ? 'bg-[#242424] text-gray-400' : 'bg-[#f1eee7] text-gray-500'}`}><tr><th className="p-3">Billing period</th><th className="p-3">Amount</th><th className="p-3">Recorded</th></tr></thead><tbody className="divide-y divide-inherit">{masterWaterBills.length === 0 ? <tr><td colSpan="3" className="p-8 text-center text-gray-500">No utility bills have been logged yet.</td></tr> : masterWaterBills.map(bill => <tr key={bill.id}><td className="p-3 font-medium">{bill.month}</td><td className="p-3 font-semibold">{formatKes(bill.amount)}</td><td className="p-3 text-gray-500">{bill.date ? new Date(bill.date).toLocaleDateString() : '—'}</td></tr>)}</tbody></table></div></div>
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
                  <div className="flex flex-wrap gap-2">
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

                <div className={`rounded-2xl border overflow-hidden shadow-sm mt-8 ${theme === 'dark' ? 'bg-slate-900 border-slate-800' : 'bg-[#F4EFE6] border-[#E8DFCE]'}`}>
                  <div className={`p-5 border-b flex flex-col sm:flex-row sm:items-center justify-between gap-3 ${theme === 'dark' ? 'bg-slate-950 border-slate-800' : 'bg-[#FDFBF7] border-[#E8DFCE]'}`}>
                    <div>
                      <h3 className={`font-bold flex items-center gap-2 text-lg ${theme === 'dark' ? 'text-white' : 'text-gray-900'}`}><Trash2 size={20}/> Garbage Collection</h3>
                      <p className="mt-1 text-sm text-gray-500">Collection dates, service providers, costs, and notes.</p>
                    </div>
                    <button type="button" onClick={() => { setModalError(''); setIsGarbageModalOpen(true); }} className="self-start sm:self-auto rounded-lg bg-gray-800 px-4 py-2 text-sm font-semibold text-white hover:bg-gray-900">Log Collection</button>
                  </div>
                  <div className="overflow-x-auto">
                    <table className="w-full min-w-150 text-left text-sm">
                      <thead className={`border-b ${theme === 'dark' ? 'bg-slate-950 border-slate-800 text-slate-400' : 'bg-[#FDFBF7] border-[#E8DFCE] text-gray-500'}`}>
                        <tr>
                          <th className="p-4 font-bold">Collection Date</th>
                          <th className="p-4 font-bold">Service Provider</th>
                          <th className="p-4 font-bold">Cost</th>
                          <th className="p-4 font-bold">Notes</th>
                          <th className="p-4 font-bold">Logged By</th>
                        </tr>
                      </thead>
                      <tbody className={`divide-y ${theme === 'dark' ? 'divide-slate-800' : 'divide-[#E8DFCE]'}`}>
                        {garbageLogs.length === 0 && (
                          <tr><td colSpan="5" className="p-8 text-center font-medium text-gray-500">No garbage collections logged yet.</td></tr>
                        )}
                        {garbageLogs.map(log => (
                          <tr key={log.id} className={`transition ${theme === 'dark' ? 'hover:bg-slate-950/40' : 'hover:bg-[#FDFBF7]'}`}>
                            <td className="p-4 font-medium text-gray-500">{new Date(log.date).toLocaleDateString('en-KE', { timeZone: DEFAULT_TIMEZONE })}</td>
                            <td className={`p-4 font-bold ${theme === 'dark' ? 'text-white' : 'text-gray-900'}`}>{log.provider}</td>
                            <td className={`p-4 font-mono font-bold ${theme === 'dark' ? 'text-white' : 'text-gray-900'}`}>{formatKes(log.cost)}</td>
                            <td className={`max-w-xs whitespace-normal p-4 ${theme === 'dark' ? 'text-slate-300' : 'text-gray-600'}`}>{log.notes || '—'}</td>
                            <td className="p-4 text-gray-500">{log.loggedBy}</td>
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
            <p><PortfolioLink theme={theme}>@Gikunjucreates</PortfolioLink></p>
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

      {toastMessage && (
        <div role="status" className="fixed right-4 top-4 z-100 flex max-w-sm items-center gap-3 rounded-xl bg-emerald-700 px-4 py-3 text-sm font-bold text-white shadow-xl">
          <CheckCircle2 size={19} />
          <span>{toastMessage}</span>
          <button type="button" aria-label="Dismiss notification" onClick={() => setToastMessage('')} className="ml-2 rounded p-1 hover:bg-white/10"><X size={16} /></button>
        </div>
      )}

      {isCycleModalOpen && (
        <div className="fixed inset-0 z-60 flex items-center justify-center bg-black/60 p-4 backdrop-blur-sm" onClick={() => !isProcessing && setIsCycleModalOpen(false)}>
          <div role="dialog" aria-modal="true" aria-labelledby="cycle-dialog-title" className={`w-full max-w-md rounded-2xl border p-6 shadow-2xl ${theme === 'dark' ? 'border-slate-800 bg-slate-900 text-white' : 'border-[#E8DFCE] bg-white text-gray-900'}`} onClick={e => e.stopPropagation()}>
            <div className="mb-5 flex items-center justify-between">
              <div>
                <h3 id="cycle-dialog-title" className="text-xl font-bold">Open a billing cycle</h3>
                <p className="mt-1 text-sm text-gray-500">Opening a month closes the current cycle.</p>
              </div>
              <button type="button" disabled={isProcessing} onClick={() => setIsCycleModalOpen(false)} className="rounded-lg p-2 text-gray-500 hover:bg-black/5 disabled:opacity-50" aria-label="Close dialog"><X size={20} /></button>
            </div>
            <form onSubmit={handleOpenCycle} className="space-y-4">
              <div>
                <label htmlFor="cycle-month" className="mb-1.5 block text-xs font-bold uppercase tracking-wider text-gray-500">Month</label>
                <select id="cycle-month" value={cycleMonth} onChange={e => setCycleMonth(Number(e.target.value))} className={`w-full rounded-xl border p-3 outline-none focus:border-emerald-500 ${theme === 'dark' ? 'border-slate-700 bg-slate-950 text-white' : 'border-[#DCD4C6] bg-white text-gray-900'}`}>
                  {monthNames.map((month, index) => <option key={month} value={index}>{month}</option>)}
                </select>
              </div>
              <div>
                <label htmlFor="cycle-year" className="mb-1.5 block text-xs font-bold uppercase tracking-wider text-gray-500">Year</label>
                <input id="cycle-year" required type="number" min="2000" max="2200" value={cycleYear} onChange={e => setCycleYear(e.target.value)} className={`w-full rounded-xl border p-3 outline-none focus:border-emerald-500 ${theme === 'dark' ? 'border-slate-700 bg-slate-950 text-white' : 'border-[#DCD4C6] bg-white text-gray-900'}`} />
              </div>
              <div className="flex justify-end gap-2 pt-2">
                <button type="button" disabled={isProcessing} onClick={() => setIsCycleModalOpen(false)} className={`rounded-xl px-4 py-2.5 text-sm font-bold disabled:opacity-50 ${theme === 'dark' ? 'text-slate-300 hover:bg-white/5' : 'text-gray-600 hover:bg-black/5'}`}>Cancel</button>
                <button type="submit" disabled={isProcessing} className="rounded-xl bg-gray-800 px-5 py-2.5 text-sm font-bold text-white transition hover:bg-gray-900 disabled:opacity-50">{isProcessing ? 'Opening…' : 'Open Cycle'}</button>
              </div>
            </form>
          </div>
        </div>
      )}

      {isBackfillCycleModalOpen && (
        <div className="fixed inset-0 z-60 flex items-center justify-center bg-black/60 p-4" onClick={() => !isProcessing && setIsBackfillCycleModalOpen(false)}>
          <div role="dialog" aria-modal="true" aria-labelledby="backfill-cycle-title" className={`app-enter w-full max-w-md rounded-2xl border p-6 shadow-2xl ${theme === 'dark' ? 'border-[#383838] bg-[#1f1f1f] text-white' : 'border-[#e7e1d7] bg-[#fffdf9] text-gray-900'}`} onClick={e => e.stopPropagation()}>
            <div className="mb-5 flex items-center justify-between">
              <div>
                <h3 id="backfill-cycle-title" className="text-xl font-semibold">Add a past billing month</h3>
                <p className="mt-1 text-sm text-gray-500">This leaves the active month untouched.</p>
              </div>
              <button type="button" disabled={isProcessing} onClick={() => setIsBackfillCycleModalOpen(false)} className="rounded-lg p-2 text-gray-500 hover:bg-black/5 disabled:opacity-50" aria-label="Close dialog"><X size={20}/></button>
            </div>
            <form onSubmit={handleBackfillCycle} className="space-y-4">
              {modalError && <p role="alert" className="rounded-lg border border-rose-200 bg-rose-50 p-3 text-sm text-rose-700">{modalError}</p>}
              <div>
                <label htmlFor="backfill-cycle-month" className="mb-1.5 block text-xs font-semibold uppercase tracking-wider text-gray-500">Month</label>
                <select id="backfill-cycle-month" value={backfillCycleMonth} onChange={e => setBackfillCycleMonth(Number(e.target.value))} className={`w-full rounded-xl border p-3 outline-none focus:border-[#2f5542] ${theme === 'dark' ? 'border-[#505050] bg-[#111111] text-white' : 'border-[#d8d2c8] bg-white text-gray-900'}`}>
                  {monthNames.map((month, index) => <option key={month} value={index}>{month}</option>)}
                </select>
              </div>
              <div>
                <label htmlFor="backfill-cycle-year" className="mb-1.5 block text-xs font-semibold uppercase tracking-wider text-gray-500">Year</label>
                <input id="backfill-cycle-year" required type="number" min="2000" max={new Date().getFullYear()} value={backfillCycleYear} onChange={e => setBackfillCycleYear(e.target.value)} className={`w-full rounded-xl border p-3 outline-none focus:border-[#2f5542] ${theme === 'dark' ? 'border-[#505050] bg-[#111111] text-white' : 'border-[#d8d2c8] bg-white text-gray-900'}`} />
              </div>
              <p className="text-xs leading-5 text-gray-500">Rent starts from the unit’s current rent and water starts at KSh 0. Review each tenant’s historical bill and correct those amounts before adding payments.</p>
              <div className="flex justify-end gap-2 pt-2">
                <button type="button" disabled={isProcessing} onClick={() => setIsBackfillCycleModalOpen(false)} className={`rounded-xl px-4 py-2.5 text-sm font-semibold disabled:opacity-50 ${theme === 'dark' ? 'text-gray-300 hover:bg-white/5' : 'text-gray-600 hover:bg-black/5'}`}>Cancel</button>
                <button type="submit" disabled={isProcessing} className="rounded-xl bg-[#2f5542] px-5 py-2.5 text-sm font-semibold text-white hover:bg-[#244433] disabled:opacity-50">{isProcessing ? 'Adding…' : 'Add Past Month'}</button>
              </div>
            </form>
          </div>
        </div>
      )}

      {isCycleChargeModalOpen && selectedTenantCycleForEdit && (
        <div className="fixed inset-0 z-60 flex items-center justify-center bg-black/60 p-4" onClick={() => !isProcessing && setIsCycleChargeModalOpen(false)}>
          <div role="dialog" aria-modal="true" aria-labelledby="historical-bill-title" className={`app-enter w-full max-w-md rounded-2xl border p-6 shadow-2xl ${theme === 'dark' ? 'border-[#383838] bg-[#1f1f1f] text-white' : 'border-[#e7e1d7] bg-[#fffdf9] text-gray-900'}`} onClick={e => e.stopPropagation()}>
            <div className="mb-5 flex items-center justify-between">
              <div>
                <h3 id="historical-bill-title" className="text-xl font-semibold">Edit past month bill</h3>
                <p className="mt-1 text-sm text-gray-500">{selectedTenantCycleForEdit.tenantName} · {billingCycles.find(cycle => cycle.id === selectedTenantCycleForEdit.cycleId)?.month}</p>
              </div>
              <button type="button" disabled={isProcessing} onClick={() => setIsCycleChargeModalOpen(false)} className="rounded-lg p-2 text-gray-500 hover:bg-black/5 disabled:opacity-50" aria-label="Close dialog"><X size={20}/></button>
            </div>
            <form key={selectedTenantCycleForEdit.id} onSubmit={handleUpdateClosedCycleCharges} className="space-y-4">
              {modalError && <p role="alert" className="rounded-lg border border-rose-200 bg-rose-50 p-3 text-sm text-rose-700">{modalError}</p>}
              <div>
                <label htmlFor="historical-rent" className="mb-1.5 block text-xs font-semibold uppercase tracking-wider text-gray-500">Rent billed (KES)</label>
                <input id="historical-rent" name="expectedRent" required type="number" min={selectedTenantCycleForEdit.paidRent || 0} step="0.01" defaultValue={selectedTenantCycleForEdit.expectedRent} className={`w-full rounded-xl border p-3 outline-none focus:border-[#2f5542] ${theme === 'dark' ? 'border-[#505050] bg-[#111111] text-white' : 'border-[#d8d2c8] bg-white text-gray-900'}`} />
              </div>
              <div>
                <label htmlFor="historical-water" className="mb-1.5 block text-xs font-semibold uppercase tracking-wider text-gray-500">Water billed (KES)</label>
                <input id="historical-water" name="expectedWater" required type="number" min={selectedTenantCycleForEdit.paidWater || 0} step="0.01" defaultValue={selectedTenantCycleForEdit.expectedWater} className={`w-full rounded-xl border p-3 outline-none focus:border-[#2f5542] ${theme === 'dark' ? 'border-[#505050] bg-[#111111] text-white' : 'border-[#d8d2c8] bg-white text-gray-900'}`} />
              </div>
              <p className="text-xs leading-5 text-gray-500">The billed amount cannot be set below payments already recorded for that charge.</p>
              <div className="flex justify-end gap-2 pt-2">
                <button type="button" disabled={isProcessing} onClick={() => setIsCycleChargeModalOpen(false)} className={`rounded-xl px-4 py-2.5 text-sm font-semibold disabled:opacity-50 ${theme === 'dark' ? 'text-gray-300 hover:bg-white/5' : 'text-gray-600 hover:bg-black/5'}`}>Cancel</button>
                <button type="submit" disabled={isProcessing} className="rounded-xl bg-[#2f5542] px-5 py-2.5 text-sm font-semibold text-white hover:bg-[#244433] disabled:opacity-50">{isProcessing ? 'Saving…' : 'Save bill'}</button>
              </div>
            </form>
          </div>
        </div>
      )}

      {confirmationAction && (
        <div className="fixed inset-0 z-70 flex items-center justify-center bg-black/60 p-4 backdrop-blur-sm" onClick={() => !isProcessing && setConfirmationAction(null)}>
          <div role="dialog" aria-modal="true" aria-labelledby="confirmation-title" className={`w-full max-w-md rounded-2xl border p-6 shadow-2xl ${theme === 'dark' ? 'border-slate-800 bg-slate-900 text-white' : 'border-[#E8DFCE] bg-white text-gray-900'}`} onClick={e => e.stopPropagation()}>
            <h3 id="confirmation-title" className={`text-lg font-bold ${confirmationAction.type === 'requestTenantRemoval' ? 'text-amber-600' : 'text-rose-600'}`}>
              {confirmationAction.type === 'resetData' ? 'Reset payment and operations data?' : confirmationAction.type === 'closeCycle' ? 'Close the current billing cycle?' : confirmationAction.type === 'requestTenantRemoval' ? 'Send tenant removal request?' : 'Remove tenant from the active directory?'}
            </h3>
            <p className={`mt-3 text-sm leading-relaxed ${theme === 'dark' ? 'text-slate-300' : 'text-gray-600'}`}>
              {confirmationAction.type === 'resetData'
                ? 'This will permanently erase ALL payment records, repair logs, septic logs, and water bill invoices. Tenants and houses will be preserved. This cannot be undone. Paid totals in monthly cycles will also reset, while cycle months and expected rent/water charges are preserved. Because large resets run in batches, a later failure may leave earlier batches completed; the error will identify where it stopped.'
                : confirmationAction.type === 'closeCycle'
                  ? `Close ${activeCycle?.month || 'the current month'}? New payments will require a new billing cycle.`
                  : confirmationAction.type === 'requestTenantRemoval'
                    ? `Ask the landlord to remove ${confirmationAction.tenant.name}? The tenant stays active and their financial history is preserved unless the landlord approves the request.`
                    : `Archive ${confirmationAction.tenant.name} from the active directory? Their financial history will remain available for audit.`}
            </p>
            <div className="mt-6 flex justify-end gap-2">
              <button type="button" onClick={() => setConfirmationAction(null)} disabled={isProcessing} className={`rounded-xl px-4 py-2.5 text-sm font-bold transition disabled:opacity-50 ${theme === 'dark' ? 'text-slate-300 hover:bg-white/5' : 'text-gray-600 hover:bg-black/5'}`}>Cancel</button>
              <button type="button" onClick={handleConfirmationSubmit} disabled={isProcessing} className={`rounded-xl px-4 py-2.5 text-sm font-bold text-white transition disabled:opacity-50 ${confirmationAction.type === 'requestTenantRemoval' ? 'bg-gray-800 hover:bg-gray-900' : 'bg-rose-600 hover:bg-rose-700'}`}>
                {isProcessing ? 'Working…' : confirmationAction.type === 'resetData' ? 'Reset Data' : confirmationAction.type === 'closeCycle' ? 'Close Cycle' : confirmationAction.type === 'requestTenantRemoval' ? 'Request Removal' : 'Remove Tenant'}
              </button>
            </div>
          </div>
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
              <h3 className="text-xl font-bold">{selectedHouseForEdit ? 'Edit Unit Details' : 'Add Property Unit'}</h3>
              <button onClick={() => closeAnyModal(setIsHouseModalOpen)} className={`p-2 rounded-full ${theme === 'dark' ? 'hover:bg-white/5 text-gray-400 hover:text-white' : 'hover:bg-black/5 text-gray-500 hover:text-gray-900'}`}><X/></button>
            </div>
            <form key={selectedHouseForEdit?.id || 'new-unit'} onSubmit={handleSaveHouse} className="space-y-5">
              <div>
                <label className="block text-xs font-bold text-gray-500 uppercase tracking-wider mb-2">Unit Name / Number</label>
                <input required name="name" defaultValue={selectedHouseForEdit?.name || ''} className={`w-full border rounded-xl p-3 outline-none focus:ring-2 focus:ring-gray-800 dark:focus:ring-gray-500 font-medium transition-all ${theme === 'dark' ? 'bg-slate-950 border-slate-800 text-white' : 'bg-[#F4EFE6] border-[#DCD4C6] text-gray-900'}`} placeholder="e.g. Unit A1, House B" />
              </div>
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="block text-xs font-bold text-gray-500 uppercase tracking-wider mb-2">Type</label>
                  <select name="type" defaultValue={selectedHouseForEdit?.type || 'Single Room'} className={`w-full border rounded-xl p-3 outline-none focus:ring-2 focus:ring-gray-800 dark:focus:ring-gray-500 text-sm font-medium transition-all ${theme === 'dark' ? 'bg-slate-950 border-slate-800 text-white' : 'bg-[#F4EFE6] border-[#DCD4C6] text-gray-900'}`}>
                    <option>Single Room</option>
                    <option>Double Room</option>
                  </select>
                </div>
                <div>
                  <label className="block text-xs font-bold text-gray-500 uppercase tracking-wider mb-2">Target Rent (KES)</label>
                  <input required name="rent" type="number" min="0" step="0.01" defaultValue={selectedHouseForEdit?.rent ?? ''} className={`w-full border rounded-xl p-3 outline-none focus:ring-2 focus:ring-gray-800 dark:focus:ring-gray-500 font-bold transition-all ${theme === 'dark' ? 'bg-slate-950 border-slate-800 text-white' : 'bg-[#F4EFE6] border-[#DCD4C6] text-gray-900'}`} placeholder="e.g. 15000" />
                </div>
              </div>
              {selectedHouseForEdit && <p className="text-xs leading-5 text-gray-500">Changing the unit rent affects new monthly bills. Existing month records keep the rent already billed.</p>}
              <button type="submit" disabled={isProcessing} className="w-full bg-gray-800 hover:bg-gray-900 text-white font-bold py-3.5 rounded-xl mt-6 disabled:opacity-50 transition-all shadow-md hover:shadow-lg">
                {isProcessing ? 'Saving Unit...' : selectedHouseForEdit ? 'Save Unit Details' : 'Save Unit'}
              </button>
            </form>
          </div>
        </div>
      )}

      {isTenantModalOpen && (
        <div className="fixed inset-0 bg-black/60 flex items-center justify-center p-4 z-60 backdrop-blur-sm transition-opacity" onClick={() => closeAnyModal(setIsTenantModalOpen)}>
          <div className={`rounded-3xl w-full max-w-md p-7 shadow-2xl animate-in fade-in zoom-in-95 duration-200 ${theme === 'dark' ? 'bg-slate-900 border border-slate-800 text-white' : 'bg-[#FDFBF7] border border-[#E8DFCE] text-gray-900'}`} onClick={e => e.stopPropagation()}>
            <div className="flex justify-between items-center mb-6">
              <h3 className="text-xl font-bold">{role === ROLES.MANAGER ? 'Request New Tenant' : 'Register New Tenant'}</h3>
              <button onClick={() => closeAnyModal(setIsTenantModalOpen)} className={`p-2 rounded-full ${theme === 'dark' ? 'hover:bg-white/5 text-gray-400 hover:text-white' : 'hover:bg-black/5 text-gray-500 hover:text-gray-900'}`}><X/></button>
            </div>
            {role === ROLES.MANAGER && <p className="mb-5 rounded-xl border border-amber-500/20 bg-amber-500/10 p-3 text-sm text-amber-800 dark:text-amber-300">The tenant will be added only after the landlord approves this request.</p>}
            <form onSubmit={handleAddTenant} className="space-y-4">
              <div className="grid grid-cols-2 gap-4">
                <div className="col-span-2">
                  <label className="block text-xs font-bold text-gray-500 uppercase tracking-wider mb-2">Full Name</label>
                  <input required maxLength={120} name="name" className={`w-full border rounded-xl p-3 outline-none focus:ring-2 focus:ring-gray-800 dark:focus:ring-gray-500 font-medium text-sm transition-all ${theme === 'dark' ? 'bg-slate-950 border-slate-800 text-white' : 'bg-[#F4EFE6] border-[#DCD4C6] text-gray-900'}`} />
                </div>
                <div>
                  <label className="block text-xs font-bold text-gray-500 uppercase tracking-wider mb-2">Phone Number</label>
                  <input required maxLength={40} name="phone" className={`w-full border rounded-xl p-3 outline-none focus:ring-2 focus:ring-gray-800 dark:focus:ring-gray-500 font-medium text-sm transition-all ${theme === 'dark' ? 'bg-slate-950 border-slate-800 text-white' : 'bg-[#F4EFE6] border-[#DCD4C6] text-gray-900'}`} />
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
                  <select required name="houseId" value={newTenantHouseId} onChange={event => setNewTenantHouseId(event.target.value)} className={`w-full border rounded-xl p-3 outline-none focus:ring-2 focus:ring-gray-800 dark:focus:ring-gray-500 text-sm font-bold transition-all ${theme === 'dark' ? 'bg-slate-950 border-slate-800 text-white' : 'bg-[#F4EFE6] border-[#DCD4C6] text-gray-900'}`}>
                    <option value="">-- Select Vacant Unit --</option>
                    {houses.filter(h => h.status === 'VACANT' && !occupiedHouseIds.has(h.id) && !pendingTenantCreationHouseIds.has(h.id)).map(h => (
                      <option key={h.id} value={h.id}>{h.name} ({formatKes(h.rent)})</option>
                    ))}
                  </select>
                </div>
                <div className={`col-span-2 grid grid-cols-2 gap-3 rounded-xl border p-4 ${theme === 'dark' ? 'border-slate-800 bg-slate-950' : 'border-[#E8DFCE] bg-[#F4EFE6]'}`}>
                  <div>
                    <p className="text-[10px] font-bold uppercase tracking-wider text-gray-500">Monthly rent target</p>
                    <p className="mt-1 font-mono text-lg font-bold">{formatKes(selectedNewTenantHouse?.rent || 0)}</p>
                  </div>
                  <div>
                    <p className="text-[10px] font-bold uppercase tracking-wider text-gray-500">Security deposit (one month)</p>
                    <p className="mt-1 font-mono text-lg font-bold">{formatKes(selectedNewTenantHouse?.rent || 0)}</p>
                  </div>
                  <p className="col-span-2 text-xs text-gray-500">Rent and deposit follow the selected unit’s rent. Water is added separately for each billing month after the tenant’s share is calculated.</p>
                </div>
              </div>
              <button type="submit" disabled={isProcessing} className="w-full bg-gray-800 hover:bg-gray-900 text-white font-bold py-3.5 rounded-xl mt-6 disabled:opacity-50 transition-all shadow-md hover:shadow-lg">
                {isProcessing ? (role === ROLES.MANAGER ? 'Submitting Request…' : 'Saving Details…') : (role === ROLES.MANAGER ? 'Submit for Landlord Approval' : 'Save Tenant')}
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
                  <label className="block text-xs font-bold text-gray-500 uppercase tracking-wider mb-2">Assigned Property Unit</label>
                  <select required name="houseId" value={editTenantHouseId} onChange={event => setEditTenantHouseId(event.target.value)} className={`w-full border rounded-xl p-3 outline-none focus:ring-2 focus:ring-gray-800 dark:focus:ring-gray-500 text-sm font-bold transition-all ${theme === 'dark' ? 'bg-slate-950 border-slate-800 text-white' : 'bg-[#F4EFE6] border-[#DCD4C6] text-gray-900'}`}>
                    <option value="">-- Select a property unit --</option>
                    {houses.filter(h => h.id === selectedTenantForDetails.houseId || (h.status === 'VACANT' && !occupiedHouseIds.has(h.id))).map(h => (
                      <option key={h.id} value={h.id}>{h.id === selectedTenantForDetails.houseId ? 'Keep Current Unit: ' : 'Move to: '}{h.name}</option>
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
                <div className={`col-span-2 grid grid-cols-2 gap-3 rounded-xl border p-4 ${theme === 'dark' ? 'border-slate-800 bg-slate-950' : 'border-[#E8DFCE] bg-[#F4EFE6]'}`}>
                  <div>
                    <p className="text-[10px] font-bold uppercase tracking-wider text-gray-500">Monthly rent target</p>
                    <p className="mt-1 font-mono text-lg font-bold">{formatKes(selectedEditTenantHouse?.rent ?? selectedTenantForDetails.expectedRent ?? 0)}</p>
                  </div>
                  <div>
                    <p className="text-[10px] font-bold uppercase tracking-wider text-gray-500">Security deposit (one month)</p>
                    <p className="mt-1 font-mono text-lg font-bold">{formatKes(selectedEditTenantHouse?.rent ?? selectedTenantForDetails.expectedRent ?? 0)}</p>
                  </div>
                  <p className="col-span-2 text-xs text-gray-500">The rent target and deposit are tied to the selected unit. Set each tenant’s water share separately for the active billing month.</p>
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
              <div><p className="font-medium">Tenant: <strong className={`text-base block mt-0.5 ${theme === 'dark' ? 'text-white' : 'text-gray-900'}`}>{selectedTenant.name}</strong></p><p className="mt-1 text-[10px] font-semibold text-gray-500">{selectedPaymentCycle?.month || 'No billing cycle'}</p></div>
              <div className="text-right shrink-0 whitespace-nowrap text-xs">
                <p className="font-medium">Owes Rent: <strong className={`font-bold ${theme === 'dark' ? 'text-rose-500' : 'text-rose-600'}`}>{formatKes(Number(selectedPaymentTenantCycle?.expectedRent || 0) - Number(selectedPaymentTenantCycle?.paidRent || 0))}</strong></p>
                <p className="font-medium mt-0.5">Owes Water: <strong className={`font-bold ${theme === 'dark' ? 'text-rose-500' : 'text-rose-600'}`}>{formatKes(Number(selectedPaymentTenantCycle?.expectedWater || 0) - Number(selectedPaymentTenantCycle?.paidWater || 0))}</strong></p>
              </div>
            </div>
            
            <form onSubmit={handleLogPayment} className="space-y-5">
              <div>
                <label className="block text-xs font-bold text-gray-500 uppercase tracking-wider mb-2">Transaction Ref / Code</label>
                <input required={isLandlord} name="messageCode" type="text" placeholder="e.g. QKX2T1..." className={`w-full border rounded-xl p-3 outline-none focus:ring-2 focus:ring-gray-800 dark:focus:ring-gray-500 font-mono uppercase font-bold transition-all ${theme === 'dark' ? 'bg-slate-950 border-slate-800 text-white' : 'bg-[#F4EFE6] border-[#DCD4C6] text-gray-900'}`} />
                {!isLandlord && <p className="mt-1.5 text-xs text-gray-500">If the reference is unavailable, leave this blank. The landlord must enter it before confirming the payment.</p>}
              </div>
              <div>
                <label className="block text-xs font-bold text-gray-500 uppercase tracking-wider mb-2">Payment Date</label>
                <input required name="paymentDate" type="date" defaultValue={selectedPaymentCycle?.status === 'CLOSED' ? `${selectedPaymentCycle.year}-${String(Number(selectedPaymentCycle.monthIndex) + 1).padStart(2, '0')}-01` : new Date().toISOString().slice(0, 10)} className={`w-full border rounded-xl p-3 text-sm outline-none focus:ring-2 focus:ring-gray-800 dark:focus:ring-gray-500 ${theme === 'dark' ? 'bg-slate-950 border-slate-800 text-white' : 'bg-[#F4EFE6] border-[#DCD4C6] text-gray-900'}`} />
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
                <FileText size={18}/> {isProcessing ? 'Logging...' : (!canApproveRent ? 'Submit for Landlord Review' : 'Log & Confirm Receipt')}
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
            <p className="text-xs text-gray-500 font-medium mb-6">Set this tenant’s allocated water share for {activeCycle?.month || 'the open billing cycle'}. This replaces the current share; rent is set from the property unit.</p>
            <form onSubmit={handleUpdateBills} className="space-y-5">
              <div>
                <label className="block text-xs font-bold text-gray-500 uppercase tracking-wider mb-2">Tenant’s Water Share for this Month (KES)</label>
                <input required name="waterShare" type="number" min="0" step="0.01" defaultValue={selectedTenantCycle?.expectedWater || 0} className={`w-full border rounded-xl p-3 outline-none focus:ring-2 focus:ring-gray-800 dark:focus:ring-gray-500 font-bold transition-all ${theme === 'dark' ? 'bg-slate-950 border-slate-800 text-white' : 'bg-[#F4EFE6] border-[#DCD4C6] text-gray-900'}`} />
              </div>
              <button type="submit" disabled={isProcessing} className="w-full bg-gray-800 hover:bg-gray-900 text-white font-bold py-3.5 rounded-xl mt-6 disabled:opacity-50 transition-all shadow-md hover:shadow-lg">
                {isProcessing ? 'Updating Ledger...' : 'Save Water Share'}
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

      {isGarbageModalOpen && (
        <div className="fixed inset-0 z-60 flex items-center justify-center bg-black/60 p-4 backdrop-blur-sm" onClick={() => closeAnyModal(setIsGarbageModalOpen)}>
          <div role="dialog" aria-modal="true" aria-labelledby="garbage-dialog-title" className={`w-full max-w-md rounded-2xl border p-6 shadow-2xl ${theme === 'dark' ? 'border-slate-800 bg-slate-900 text-white' : 'border-[#E8DFCE] bg-[#FDFBF7] text-gray-900'}`} onClick={event => event.stopPropagation()}>
            <div className="mb-5 flex items-center justify-between gap-3">
              <div>
                <h3 id="garbage-dialog-title" className="text-xl font-bold">Log Garbage Collection</h3>
                <p className="mt-1 text-sm text-gray-500">Record a pickup and its cost.</p>
              </div>
              <button type="button" onClick={() => closeAnyModal(setIsGarbageModalOpen)} className={`rounded-lg p-2 ${theme === 'dark' ? 'text-gray-300 hover:bg-white/5' : 'text-gray-500 hover:bg-black/5'}`} aria-label="Close garbage collection form"><X size={18}/></button>
            </div>
            <form onSubmit={handleLogGarbage} className="space-y-4">
              <div>
                <label htmlFor="garbage-date" className="mb-1.5 block text-xs font-semibold text-gray-500">Collection date</label>
                <input id="garbage-date" name="date" type="date" required defaultValue={new Date().toLocaleDateString('en-CA', { timeZone: DEFAULT_TIMEZONE })} className={`w-full rounded-lg border p-2.5 text-sm outline-none focus:ring-2 focus:ring-amber-600/40 ${theme === 'dark' ? 'border-[#303030] bg-[#0A0A0A] text-white' : 'border-[#E5E5E5] bg-white text-gray-900'}`} />
              </div>
              <div>
                <label htmlFor="garbage-provider" className="mb-1.5 block text-xs font-semibold text-gray-500">Service provider</label>
                <input id="garbage-provider" name="provider" required maxLength="80" placeholder="Provider or collector" className={`w-full rounded-lg border p-2.5 text-sm outline-none focus:ring-2 focus:ring-amber-600/40 ${theme === 'dark' ? 'border-[#303030] bg-[#0A0A0A] text-white' : 'border-[#E5E5E5] bg-white text-gray-900'}`} />
              </div>
              <div>
                <label htmlFor="garbage-cost" className="mb-1.5 block text-xs font-semibold text-gray-500">Cost ({DEFAULT_CURRENCY})</label>
                <input id="garbage-cost" name="cost" type="number" min="0" step="0.01" required defaultValue="0" className={`w-full rounded-lg border p-2.5 text-sm outline-none focus:ring-2 focus:ring-amber-600/40 ${theme === 'dark' ? 'border-[#303030] bg-[#0A0A0A] text-white' : 'border-[#E5E5E5] bg-white text-gray-900'}`} />
              </div>
              <div>
                <label htmlFor="garbage-notes" className="mb-1.5 block text-xs font-semibold text-gray-500">Notes (optional)</label>
                <textarea id="garbage-notes" name="notes" maxLength="300" rows="3" placeholder="Pickup details" className={`w-full resize-y rounded-lg border p-2.5 text-sm outline-none focus:ring-2 focus:ring-amber-600/40 ${theme === 'dark' ? 'border-[#303030] bg-[#0A0A0A] text-white' : 'border-[#E5E5E5] bg-white text-gray-900'}`} />
              </div>
              <button type="submit" disabled={isProcessing} className="w-full rounded-lg bg-gray-800 py-3 text-sm font-semibold text-white hover:bg-gray-900 disabled:opacity-50">
                {isProcessing ? 'Saving…' : 'Save collection log'}
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
                <label className="block text-xs font-bold text-gray-500 uppercase tracking-wider mb-2">Monthly ledger</label>
                <select name="cycleId" defaultValue={activeCycle?.id || ''} className={`w-full border rounded-xl p-3 text-sm outline-none focus:ring-2 focus:ring-emerald-600/20 ${theme === 'dark' ? 'bg-[#111111] border-[#383838] text-white' : 'bg-[#f6f4ef] border-[#d8d2c8] text-gray-900'}`}>
                  <option value="">Do not assign to a month</option>
                  {billingCycles.filter(cycle => role === ROLES.LANDLORD || cycle.status === 'OPEN').map(cycle => <option key={cycle.id} value={cycle.id}>{cycle.month}{cycle.status === 'CLOSED' ? ' · Closed' : ' · Active'}</option>)}
                </select>
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
                <div className={`p-4 rounded-2xl border ${theme === 'dark' ? 'bg-slate-950 border-slate-800' : 'bg-[#F4EFE6] border-[#E8DFCE]'}`}>
                  <p className="text-[10px] text-gray-500 font-bold uppercase tracking-wider mb-1.5">Monthly Rent</p>
                  <p className="font-mono text-lg font-black">{formatKes(selectedDetailRent)}</p>
                </div>
                <div className={`p-4 rounded-2xl border ${theme === 'dark' ? 'bg-slate-950 border-slate-800' : 'bg-[#F4EFE6] border-[#E8DFCE]'}`}>
                  <p className="text-[10px] text-gray-500 font-bold uppercase tracking-wider mb-1.5">Security Deposit (one month)</p>
                  <p className="font-mono text-lg font-black">{formatKes(selectedDetailDeposit)}</p>
                </div>
              </div>

              <div>
                <h4 className={`font-extrabold text-lg mb-3 border-b pb-3 ${theme === 'dark' ? 'border-slate-800' : 'border-[#DCD4C6]'}`}>Outstanding Balances</h4>
                <div className="flex gap-4">
                  <div className="flex-1">
                    <p className="text-xs text-gray-500 font-bold uppercase tracking-wider mb-1">Rent Arrears</p>
                    <p className={`font-mono text-xl font-black ${selectedDetailRentDue > 0 ? (theme === 'dark' ? 'text-rose-500' : 'text-rose-600') : (theme === 'dark' ? 'text-emerald-500' : 'text-emerald-600')}`}>{formatKes(selectedDetailRentDue)}</p>
                  </div>
                  <div className="flex-1">
                    <p className="text-xs text-gray-500 font-bold uppercase tracking-wider mb-1">Water Arrears</p>
                    <p className={`font-mono text-xl font-black ${selectedDetailWaterDue > 0 ? (theme === 'dark' ? 'text-rose-500' : 'text-rose-600') : (theme === 'dark' ? 'text-emerald-500' : 'text-emerald-600')}`}>{formatKes(selectedDetailWaterDue)}</p>
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
                {(role === ROLES.LANDLORD || role === ROLES.MANAGER) && <button onClick={() => handleDeleteTenant(selectedTenantForDetails)} disabled={isProcessing} className={`text-sm font-bold px-4 py-2.5 rounded-xl transition disabled:opacity-50 ${theme === 'dark' ? 'text-rose-500 hover:bg-rose-500/10' : 'text-rose-600 hover:bg-rose-500/10'}`}>{isLandlord ? 'Remove Tenant' : 'Request Removal'}</button>}
                {canManageTenants ? (
                  <button onClick={() => { setEditTenantHouseId(selectedTenantForDetails.houseId || ''); setModalError(''); setIsEditTenantModalOpen(true); }} disabled={isProcessing} className="bg-gray-800 hover:bg-gray-900 text-white font-bold text-sm px-6 py-3 rounded-xl transition flex items-center gap-2 shadow-md hover:shadow-lg"><Edit size={16}/> Edit Details</button>
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
