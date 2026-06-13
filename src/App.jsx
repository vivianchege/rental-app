import React, { useState, useEffect, useMemo } from 'react';
import { 
  Users, Home, Wallet, Wrench, LayoutDashboard, LogOut, 
  CheckCircle2, Plus, AlertCircle, Phone, X, ShieldCheck, UserCog, 
  Check, Clock, FileText, Calendar, Edit, Info, Coins, ListOrdered,
  Droplet, Truck, Sun, Moon, BellRing, ChevronRight, Menu
} from 'lucide-react';

// --- FIREBASE IMPORTS ---
import { initializeApp, getApps, getApp } from 'firebase/app';
import { getAuth, signInWithEmailAndPassword, onAuthStateChanged, signOut } from 'firebase/auth';
import { getFirestore, collection, onSnapshot, doc, setDoc, addDoc, updateDoc, deleteDoc } from 'firebase/firestore';

// --- FIREBASE SETUP ---
const firebaseConfig = {
  apiKey: "AIzaSyB4ng6GdlLHnFj-ht0UbWGQi-PfHkM_4jE",
  authDomain: "hse-app-b1d2b.firebaseapp.com",
  projectId: "hse-app-b1d2b",
  storageBucket: "hse-app-b1d2b.firebasestorage.app",
  messagingSenderId: "385727030262",
  appId: "1:385727030262:web:07a4728292a2d1d3905dd7"
};

const app = getApps().length === 0 ? initializeApp(firebaseConfig) : getApp();
const auth = getAuth(app);
const db = getFirestore(app);
const appId = "hse-app-b1d2b"; 

// --- CONFIGURE YOUR EMAILS AND ROLES HERE ---
const LANDLORD_EMAIL = "pngikunju671@gmail.com";
const LANDLORD_UID = "b4HMBcL0WXT3Qg2vunj5ITZOVb72";

// Safe database timeout wrapper to prevent sandbox freezes
const promiseTimeout = (promise, ms = 15000) => {
  return Promise.race([
    promise,
    new Promise((_, reject) => setTimeout(() => reject(new Error("Database operation timed out. Please check your network connection.")), ms))
  ]);
};

export default function App() {
  const [theme, setTheme] = useState(() => localStorage.getItem('ruiru_theme') || 'light');
  const [user, setUser] = useState(null);
  const [role, setRole] = useState(null);
  const [activeTab, setActiveTab] = useState('dashboard');
  const [loading, setLoading] = useState(true);
  const [sidebarOpen, setSidebarOpen] = useState(false); // New state for mobile menu

  // Global states for errors and visual loading states
  const [isProcessing, setIsProcessing] = useState(false);
  const [modalError, setModalError] = useState('');

  // Authentication State Variables
  const [loginTab, setLoginTab] = useState('landlord'); 
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [loginError, setLoginError] = useState('');

  // Live Database States
  const [houses, setHouses] = useState([]);
  const [tenants, setTenants] = useState([]);
  const [payments, setPayments] = useState([]);
  const [repairs, setRepairs] = useState([]);
  const [septicLogs, setSepticLogs] = useState([]);
  const [masterWaterBills, setMasterWaterBills] = useState([]);

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
  
  // Selection Targets
  const [selectedTenant, setSelectedTenant] = useState(null); 
  const [selectedTenantForDetails, setSelectedTenantForDetails] = useState(null); 
  const [selectedRepair, setSelectedRepair] = useState(null); 
  const [isEditTenantModalOpen, setIsEditTenantModalOpen] = useState(false);

  useEffect(() => {
    localStorage.setItem('ruiru_theme', theme);
  }, [theme]);

  useEffect(() => {
    const unsubscribe = onAuthStateChanged(auth, (currentUser) => {
      setUser(currentUser);
      if (currentUser) {
        const assignedRole = currentUser.uid === LANDLORD_UID ? 'LANDLORD' : 'MANAGER';
        setRole(assignedRole);
        setActiveTab(assignedRole === 'LANDLORD' ? 'dashboard' : 'houses');
      } else {
        setRole(null);
      }
      setLoading(false);
    });
    return () => unsubscribe();
  }, []);

  useEffect(() => {
    if (!user) return;
    const getColRef = (colName) => collection(db, 'artifacts', appId, 'public', 'data', colName);

    const unsubHouses = onSnapshot(getColRef('houses'), (snap) => setHouses(snap.docs.map(d => ({ id: d.id, ...d.data() }))), console.error);
    const unsubTenants = onSnapshot(getColRef('tenants'), (snap) => setTenants(snap.docs.map(d => ({ id: d.id, ...d.data() }))), console.error);
    const unsubPayments = onSnapshot(getColRef('payments'), (snap) => setPayments(snap.docs.map(d => ({ id: d.id, ...d.data() })).sort((a, b) => new Date(b.date) - new Date(a.date))), console.error);
    const unsubRepairs = onSnapshot(getColRef('repairs'), (snap) => setRepairs(snap.docs.map(d => ({ id: d.id, ...d.data() })).sort((a, b) => new Date(b.date) - new Date(a.date))), console.error);
    const unsubSeptic = onSnapshot(getColRef('septicLogs'), (snap) => setSepticLogs(snap.docs.map(d => ({ id: d.id, ...d.data() })).sort((a, b) => new Date(b.date) - new Date(a.date))), console.error);
    const unsubWaterBills = onSnapshot(getColRef('masterWaterBills'), (snap) => setMasterWaterBills(snap.docs.map(d => ({ id: d.id, ...d.data() })).sort((a, b) => new Date(b.date) - new Date(a.date))), console.error);

    return () => { unsubHouses(); unsubTenants(); unsubPayments(); unsubRepairs(); unsubSeptic(); unsubWaterBills(); };
  }, [user]);

  // Derived occupancies to prevent double tenant entries on the same house
  const occupiedHouseIds = useMemo(() => {
    return new Set(tenants.map(t => t.houseId).filter(Boolean));
  }, [tenants]);

  const handleLoginSubmit = async (e) => {
    e.preventDefault();
    setLoginError('');
    if (loginTab === 'landlord' && email.trim().toLowerCase() !== LANDLORD_EMAIL.toLowerCase()) {
      setLoginError("Please use Super Admin's email to login.");
      return;
    }
    setIsProcessing(true);
    try {
      await signInWithEmailAndPassword(auth, email, password);
    } catch (error) {
      setLoginError(error.message.replace("Firebase: ", ""));
    } finally {
      setIsProcessing(false);
    }
  };

  const handleLogout = async () => {
    try { await signOut(auth); setRole(null); } catch (error) { console.error(error); }
  };

  const closeAnyModal = (setter) => {
    setter(false);
    setModalError('');
  };

  // --- REBUILT IMMUNE CRUD OPERATIONS ---

  const handleAddHouse = async (e) => {
    e.preventDefault();
    if (!user || isProcessing) return;
    setIsProcessing(true);
    setModalError('');
    try {
      const formData = new FormData(e.target);
      const rawHouseName = formData.get('name').trim();

      if (!rawHouseName) {
        throw new Error("Unit name cannot be blank.");
      }

      if (houses.some(h => h.name.trim().toLowerCase() === rawHouseName.toLowerCase())) {
        throw new Error(`A unit named "${rawHouseName}" already exists in your inventory.`);
      }

      const addPromise = addDoc(collection(db, 'artifacts', appId, 'public', 'data', 'houses'), {
        name: rawHouseName,
        type: formData.get('type'),
        rent: Number(formData.get('rent')),
        status: 'VACANT',
        repairStatus: 'GOOD'
      });

      await promiseTimeout(addPromise, 5000);
      closeAnyModal(setIsHouseModalOpen);
    } catch (err) {
      setModalError(err.message);
    } finally {
      setIsProcessing(false);
    }
  };

  // New logic for strictly handling Vacant house maintenance
  const handleToggleHouseRepairMode = async (house) => {
    if (!user || isProcessing) return;
    setIsProcessing(true);
    try {
      // Switch between UNDER_REPAIR and VACANT
      const newStatus = house.status === 'UNDER_REPAIR' ? 'VACANT' : 'UNDER_REPAIR';
      const updatePromise = updateDoc(doc(db, 'artifacts', appId, 'public', 'data', 'houses', house.id), { status: newStatus });
      await promiseTimeout(updatePromise, 5000);
    } catch (err) {
      setModalError(err.message);
    } finally {
      setIsProcessing(false);
    }
  };

  const handleAddTenant = async (e) => {
    e.preventDefault();
    if (!user || isProcessing) return;
    setIsProcessing(true);
    setModalError('');
    try {
      const formData = new FormData(e.target);
      const houseId = formData.get('houseId');
      
      if (!houseId) throw new Error("Please select an available vacant house unit.");

      // Check occupancy locally in memory first to prevent race condition issues
      if (occupiedHouseIds.has(houseId)) {
        throw new Error("That house unit has just been occupied. Please select another vacant unit.");
      }

      const tenantPromise = addDoc(collection(db, 'artifacts', appId, 'public', 'data', 'tenants'), {
        name: formData.get('name'),
        phone: formData.get('phone'),
        contactPref: formData.get('contactPref'),
        houseId: houseId,
        expectedRent: Number(formData.get('expectedRent')),
        expectedWater: Number(formData.get('expectedWater')),
        paidRent: 0,
        paidWater: 0,
        dateEntered: new Date().toISOString()
      });

      await promiseTimeout(tenantPromise, 5000);

      // Instantly mark the house as OCCUPIED in database
      const houseUpdatePromise = updateDoc(doc(db, 'artifacts', appId, 'public', 'data', 'houses', houseId), { status: 'OCCUPIED' });
      await promiseTimeout(houseUpdatePromise, 5000);

      closeAnyModal(setIsTenantModalOpen);
    } catch (err) {
      setModalError(err.message);
    } finally {
      setIsProcessing(false);
    }
  };

  const handleEditTenant = async (e) => {
    e.preventDefault();
    if (!user || role !== 'LANDLORD' || !selectedTenantForDetails || isProcessing) return;
    setIsProcessing(true);
    setModalError('');
    try {
      const formData = new FormData(e.target);
      const newHouseId = formData.get('houseId');
      const oldHouseId = selectedTenantForDetails.houseId;

      if (newHouseId && newHouseId !== oldHouseId) {
         if (occupiedHouseIds.has(newHouseId)) {
           throw new Error("Target house unit is already occupied by another tenant.");
         }
         const updateNewPromise = updateDoc(doc(db, 'artifacts', appId, 'public', 'data', 'houses', newHouseId), { status: 'OCCUPIED' });
         await promiseTimeout(updateNewPromise, 5000);
         if (oldHouseId) {
           const updateOldPromise = updateDoc(doc(db, 'artifacts', appId, 'public', 'data', 'houses', oldHouseId), { status: 'VACANT' });
           await promiseTimeout(updateOldPromise, 5000);
         }
      }

      const editPromise = updateDoc(doc(db, 'artifacts', appId, 'public', 'data', 'tenants', selectedTenantForDetails.id), {
        name: formData.get('name'),
        phone: formData.get('phone'),
        contactPref: formData.get('contactPref'),
        expectedRent: Number(formData.get('expectedRent')),
        expectedWater: Number(formData.get('expectedWater')),
        houseId: newHouseId || oldHouseId
      });

      await promiseTimeout(editPromise, 5000);
      closeAnyModal(setIsEditTenantModalOpen);
      setSelectedTenantForDetails(null);
    } catch (err) {
      setModalError(err.message);
    } finally {
      setIsProcessing(false);
    }
  };

  const handleLogPayment = async (e) => {
    e.preventDefault();
    if (!user || !selectedTenant || isProcessing) return;
    setIsProcessing(true);
    setModalError('');
    try {
      const formData = new FormData(e.target);
      const amount = Number(formData.get('amount'));
      const type = formData.get('type');
      const messageCode = formData.get('messageCode').trim().toUpperCase();
      const method = formData.get('method');

      if (messageCode && messageCode !== 'CASH' && messageCode !== 'N/A') {
        if (payments.some(p => p.messageCode?.toUpperCase() === messageCode)) {
          throw new Error(`Transaction reference "${messageCode}" has already been processed.`);
        }
      }

      const rentArrears = Math.max(0, selectedTenant.expectedRent - selectedTenant.paidRent);
      const waterArrears = Math.max(0, selectedTenant.expectedWater - selectedTenant.paidWater);

      let appliedRent = 0; let appliedWater = 0; let excessAmount = 0;

      if (type === 'RENT') {
        appliedRent = Math.min(amount, rentArrears); excessAmount = amount - appliedRent;
      } else if (type === 'WATER') {
        appliedWater = Math.min(amount, waterArrears); excessAmount = amount - appliedWater;
      } else if (type === 'COMBINED') {
        appliedRent = Math.min(amount, rentArrears);
        const remainingAfterRent = amount - appliedRent;
        appliedWater = Math.min(remainingAfterRent, waterArrears);
        excessAmount = remainingAfterRent - appliedWater;
      }

      const isConfirmed = role === 'LANDLORD';

      const paymentPromise = addDoc(collection(db, 'artifacts', appId, 'public', 'data', 'payments'), {
        tenantId: selectedTenant.id,
        tenantName: selectedTenant.name,
        amount, appliedRent, appliedWater, excessAmount, type, method, messageCode,
        status: isConfirmed ? 'CONFIRMED' : 'PENDING',
        date: new Date().toISOString(),
        loggedBy: role
      });

      await promiseTimeout(paymentPromise, 5000);

      if (isConfirmed) {
        const updateBalancePromise = updateDoc(doc(db, 'artifacts', appId, 'public', 'data', 'tenants', selectedTenant.id), { 
          paidRent: selectedTenant.paidRent + appliedRent,
          paidWater: selectedTenant.paidWater + appliedWater
        });
        await promiseTimeout(updateBalancePromise, 5000);
      }

      closeAnyModal(setIsPaymentModalOpen);
      setSelectedTenant(null);
    } catch (err) {
      setModalError(err.message);
    } finally {
      setIsProcessing(false);
    }
  };

  const handleConfirmPayment = async (payment) => {
    if (!user || role !== 'LANDLORD' || isProcessing) return;
    setIsProcessing(true);
    try {
      const tenant = tenants.find(t => t.id === payment.tenantId);
      if (!tenant) throw new Error("Tenant is no longer in the directory.");

      const rentArrears = Math.max(0, tenant.expectedRent - tenant.paidRent);
      const waterArrears = Math.max(0, tenant.expectedWater - tenant.paidWater);

      let appliedRent = 0; let appliedWater = 0; let excessAmount = 0;

      if (payment.type === 'RENT') {
        appliedRent = Math.min(payment.amount, rentArrears); excessAmount = payment.amount - appliedRent;
      } else if (payment.type === 'WATER') {
        appliedWater = Math.min(payment.amount, waterArrears); excessAmount = payment.amount - appliedWater;
      } else if (payment.type === 'COMBINED') {
        appliedRent = Math.min(payment.amount, rentArrears);
        const remainingAfterRent = payment.amount - appliedRent;
        appliedWater = Math.min(remainingAfterRent, waterArrears);
        excessAmount = remainingAfterRent - appliedWater;
      }

      const confirmPromise = updateDoc(doc(db, 'artifacts', appId, 'public', 'data', 'payments', payment.id), { 
        status: 'CONFIRMED', appliedRent, appliedWater, excessAmount 
      });
      await promiseTimeout(confirmPromise, 5000);

      const balancePromise = updateDoc(doc(db, 'artifacts', appId, 'public', 'data', 'tenants', tenant.id), { 
        paidRent: (tenant.paidRent || 0) + appliedRent,
        paidWater: (tenant.paidWater || 0) + appliedWater
      });
      await promiseTimeout(balancePromise, 5000);
    } catch (err) {
      alert(err.message);
    } finally {
      setIsProcessing(false);
    }
  };

  const handleLogRepair = async (e) => {
    e.preventDefault();
    if (!user || isProcessing) return;
    setIsProcessing(true);
    try {
      const formData = new FormData(e.target);
      const houseId = formData.get('houseId');

      const repairPromise = addDoc(collection(db, 'artifacts', appId, 'public', 'data', 'repairs'), {
        description: formData.get('description'),
        houseId: houseId,
        status: 'OPEN',
        cost: 0,
        date: new Date().toISOString(),
        loggedBy: role
      });
      await promiseTimeout(repairPromise, 5000);

      const houseUpdatePromise = updateDoc(doc(db, 'artifacts', appId, 'public', 'data', 'houses', houseId), { repairStatus: 'NEEDS_REPAIR' });
      await promiseTimeout(houseUpdatePromise, 5000);

      closeAnyModal(setIsRepairModalOpen);
    } catch(err) {
      setModalError(err.message);
    } finally {
      setIsProcessing(false);
    }
  };

  const handleResolveRepairSubmit = async (e) => {
    e.preventDefault();
    if (!user || !selectedRepair || isProcessing) return;
    setIsProcessing(true);
    try {
      const cost = Number(new FormData(e.target).get('cost')) || 0;
      
      const resolvePromise = updateDoc(doc(db, 'artifacts', appId, 'public', 'data', 'repairs', selectedRepair.id), { 
        status: 'RESOLVED', cost: cost, resolvedAt: new Date().toISOString() 
      });
      await promiseTimeout(resolvePromise, 5000);

      const goodPromise = updateDoc(doc(db, 'artifacts', appId, 'public', 'data', 'houses', selectedRepair.houseId), { repairStatus: 'GOOD' });
      await promiseTimeout(goodPromise, 5000);

      closeAnyModal(setIsResolveRepairModalOpen);
      setSelectedRepair(null);
    } catch (err) {
      setModalError(err.message);
    } finally {
      setIsProcessing(false);
    }
  };

  const handleLogSeptic = async (e) => {
    e.preventDefault();
    if (!user || isProcessing) return;
    setIsProcessing(true);
    try {
      const optionRaw = new FormData(e.target).get('provider');
      const [provider, costStr] = optionRaw.split('|');

      const septicPromise = addDoc(collection(db, 'artifacts', appId, 'public', 'data', 'septicLogs'), {
        provider: provider, cost: Number(costStr), date: new Date().toISOString(), loggedBy: role
      });
      await promiseTimeout(septicPromise, 5000);

      closeAnyModal(setIsSepticModalOpen);
    } catch(err) {
      setModalError(err.message);
    } finally {
      setIsProcessing(false);
    }
  };

  const handleLogWaterBill = async (e) => {
    e.preventDefault();
    if (!user || isProcessing) return;
    setIsProcessing(true);
    try {
      const formData = new FormData(e.target);

      const waterPromise = addDoc(collection(db, 'artifacts', appId, 'public', 'data', 'masterWaterBills'), {
        month: formData.get('month'), amount: Number(formData.get('amount')), date: new Date().toISOString(), loggedBy: role
      });
      await promiseTimeout(waterPromise, 5000);

      closeAnyModal(setIsWaterBillModalOpen);
    } catch (err) {
      setModalError(err.message);
    } finally {
      setIsProcessing(false);
    }
  };

  const handleUpdateBills = async (e) => {
    e.preventDefault();
    if (!user || !selectedTenant || isProcessing) return;
    setIsProcessing(true);
    try {
      const formData = new FormData(e.target);

      const updateBillPromise = updateDoc(doc(db, 'artifacts', appId, 'public', 'data', 'tenants', selectedTenant.id), {
        expectedRent: selectedTenant.expectedRent + Number(formData.get('addRent')),
        expectedWater: selectedTenant.expectedWater + Number(formData.get('addWater'))
      });
      await promiseTimeout(updateBillPromise, 5000);

      closeAnyModal(setIsBillingModalOpen);
      setSelectedTenant(null);
    } catch (err) {
      setModalError(err.message);
    } finally {
      setIsProcessing(false);
    }
  };

  const handleDeleteTenant = async (tenant) => {
    if (!user || role !== 'LANDLORD' || !tenant || isProcessing) return;
    if (window.confirm(`Are you sure you want to completely remove tenant ${tenant.name}?`)) {
       setIsProcessing(true);
       try {
         const deletePromise = deleteDoc(doc(db, 'artifacts', appId, 'public', 'data', 'tenants', tenant.id));
         await promiseTimeout(deletePromise, 5000);

         if (tenant.houseId) {
           const vacantPromise = updateDoc(doc(db, 'artifacts', appId, 'public', 'data', 'houses', tenant.houseId), { status: 'VACANT' });
           await promiseTimeout(vacantPromise, 5000);
         }
         setSelectedTenantForDetails(null);
       } catch (err) {
         console.error(err);
         alert("Could not remove tenant safely.");
       } finally {
         setIsProcessing(false);
       }
    }
  };

  const formatKes = (amount) => `KES ${Number(amount || 0).toLocaleString('en-KE')}`;

  // --- REBUILT ACCOUNTING MATH ENGINE ---
  const stats = useMemo(() => {
    let collectedRentRev = 0, collectedWaterRev = 0, totalJosephBonus = 0, pendingPaymentsCount = 0;
    let totalRepairExpenses = 0, totalSepticExpenses = 0, totalMasterWaterBills = 0;

    // 1. Gather all actual cash collected through confirmed ledger payments
    payments.forEach(p => {
      if (p.status === 'CONFIRMED') {
        collectedRentRev += (p.appliedRent || 0);
        collectedWaterRev += (p.appliedWater || 0);
        if (p.excessAmount) totalJosephBonus += p.excessAmount;
      }
      if (p.status === 'PENDING') pendingPaymentsCount++;
    });

    // 2. Gather outstanding active debt balances from current live tenants
    let activeRentArrears = 0, activeWaterArrears = 0;
    tenants.forEach(t => {
      const rBal = (t.expectedRent || 0) - (t.paidRent || 0);
      const wBal = (t.expectedWater || 0) - (t.paidWater || 0);
      if (rBal > 0) activeRentArrears += rBal;
      if (wBal > 0) activeWaterArrears += wBal;
    });

    // Expected target balances are dynamic sums of actual collection + current active debts
    const expectedRentRev = collectedRentRev + activeRentArrears;
    const expectedWaterRev = collectedWaterRev + activeWaterArrears;

    // Expenses accounting
    repairs.forEach(r => { if (r.status === 'RESOLVED' && r.cost) totalRepairExpenses += r.cost; });
    septicLogs.forEach(s => { if (s.cost) totalSepticExpenses += s.cost; });
    masterWaterBills.forEach(m => { if (m.amount) totalMasterWaterBills += m.amount; });

    // Water Vault calculation (Collections less Provider master bills)
    const waterReserve = collectedWaterRev - totalMasterWaterBills;
    const totalOperatingExpenses = totalRepairExpenses + totalSepticExpenses;

    return {
      expectedRentRev, collectedRentRev, expectedWaterRev, collectedWaterRev,
      pendingPaymentsCount, totalJosephBonus, totalOperatingExpenses, totalMasterWaterBills, waterReserve,
      vacantHouses: houses.filter(h => h.status === 'VACANT' && !occupiedHouseIds.has(h.id)).length,
      openRepairs: repairs.filter(r => r.status === 'OPEN').length,
      totalRepairExpenses, totalSepticExpenses
    };
  }, [tenants, houses, repairs, payments, septicLogs, masterWaterBills, occupiedHouseIds]);

  const tenantPaymentHistory = useMemo(() => {
    if (!selectedTenant) return [];
    return payments.filter(p => p.tenantId === selectedTenant.id && p.status === 'CONFIRMED');
  }, [selectedTenant, payments]);

  const isEmailRestrictedForLandlord = useMemo(() => {
    return loginTab === 'landlord' && email.trim() !== '' && email.trim().toLowerCase() !== LANDLORD_EMAIL.toLowerCase();
  }, [loginTab, email]);

  if (loading) {
    return (
      <div className={`min-h-screen flex flex-col gap-4 items-center justify-center ${theme === 'dark' ? 'bg-slate-950' : 'bg-[#FDFBF7]'}`}>
        <div className={`animate-spin rounded-full h-12 w-12 border-4 border-t-transparent shadow-lg ${theme === 'dark' ? 'border-slate-400' : 'border-gray-800'}`}></div>
        <p className={`font-bold text-sm tracking-widest uppercase opacity-80 animate-pulse ${theme === 'dark' ? 'text-slate-400' : 'text-gray-500'}`}>Ruiru Rentals Syncing...</p>
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

          {isEmailRestrictedForLandlord && (
            <div className="bg-amber-500/10 border border-amber-500/20 text-amber-400 p-3 rounded-lg text-xs font-semibold mb-4 flex items-start gap-2">
              <AlertCircle size={16} className="shrink-0 mt-0.5" />
              <p>Please use Super Admin's email to login.</p>
            </div>
          )}

          <form onSubmit={handleLoginSubmit} className="space-y-4">
            <div>
              <label className="block text-xs font-bold text-gray-400 uppercase tracking-wider mb-2">Account Email</label>
              <input 
                required type="email" value={email} onChange={e => setEmail(e.target.value)} 
                placeholder={loginTab === 'landlord' ? "Super Admin email address" : "Manager email address"} 
                className={`w-full bg-slate-950 border focus:border-gray-500 rounded-xl p-3 outline-none text-white text-sm transition-all ${isEmailRestrictedForLandlord ? 'border-amber-500/50' : 'border-gray-800'}`} 
              />
            </div>
            <div>
              <label className="block text-xs font-bold text-gray-400 uppercase tracking-wider mb-2">Secure Password</label>
              <input 
                required type="password" value={password} onChange={e => setPassword(e.target.value)} disabled={isEmailRestrictedForLandlord} placeholder="••••••••" 
                className={`w-full bg-slate-950 border border-gray-800 focus:border-gray-500 rounded-xl p-3 outline-none text-white text-sm disabled:opacity-30 disabled:cursor-not-allowed`} 
              />
            </div>
            <button 
              type="submit" disabled={isProcessing || isEmailRestrictedForLandlord} 
              className="w-full bg-gray-800 hover:bg-gray-700 disabled:bg-gray-900 disabled:text-gray-600 disabled:cursor-not-allowed text-white font-bold py-3 rounded-xl transition-all hover:shadow-lg flex items-center justify-center gap-2"
            >
              {isProcessing ? <div className="animate-spin rounded-full h-5 w-5 border-2 border-white border-t-transparent"></div> : 'Verify Credentials & Sign In'}
            </button>
          </form>
        </div>
      </div>
    );
  }

  return (
    <div className={`min-h-screen flex flex-col md:flex-row font-sans transition-colors duration-200 ${theme === 'dark' ? 'dark bg-slate-950 text-slate-100' : 'bg-[#FDFBF7] text-gray-900'}`}>
      
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
        
        <nav className="flex-1 p-4 space-y-1.5 overflow-y-auto">
          {role === 'LANDLORD' && (
            <button onClick={() => { setActiveTab('dashboard'); setSidebarOpen(false); }} className={`w-full flex items-center gap-3 px-4 py-3 rounded-xl text-sm font-bold transition-all ${activeTab === 'dashboard' ? 'bg-gray-800 text-white shadow-md' : theme === 'dark' ? 'hover:bg-slate-800 text-slate-400' : 'hover:bg-[#E8DFCE] text-gray-600'}`}>
              <LayoutDashboard size={18} /> Financial Dashboard
            </button>
          )}
          <button onClick={() => { setActiveTab('houses'); setSidebarOpen(false); }} className={`w-full flex items-center gap-3 px-4 py-3 rounded-xl text-sm font-bold transition-all ${activeTab === 'houses' ? 'bg-gray-800 text-white shadow-md' : theme === 'dark' ? 'hover:bg-slate-800 text-slate-400' : 'hover:bg-[#E8DFCE] text-gray-600'}`}>
            <Home size={18} /> Houses & Units
          </button>
          <button onClick={() => { setActiveTab('tenants'); setSidebarOpen(false); }} className={`w-full flex items-center gap-3 px-4 py-3 rounded-xl text-sm font-bold transition-all ${activeTab === 'tenants' ? 'bg-gray-800 text-white shadow-md' : theme === 'dark' ? 'hover:bg-slate-800 text-slate-400' : 'hover:bg-[#E8DFCE] text-gray-600'}`}>
            <Users size={18} /> Tenants Directory
          </button>
          <button onClick={() => { setActiveTab('billing'); setSidebarOpen(false); }} className={`w-full flex items-center justify-between px-4 py-3 rounded-xl text-sm font-bold transition-all ${activeTab === 'billing' ? 'bg-gray-800 text-white shadow-md' : theme === 'dark' ? 'hover:bg-slate-800 text-slate-400' : 'hover:bg-[#E8DFCE] text-gray-600'}`}>
            <div className="flex items-center gap-3"><Wallet size={18} /> Billing & Payments</div>
            {stats.pendingPaymentsCount > 0 && role === 'LANDLORD' && (
              <span className="bg-rose-500 text-white text-[10px] px-2 py-0.5 rounded-full font-bold">{stats.pendingPaymentsCount}</span>
            )}
          </button>
          <button onClick={() => { setActiveTab('repairs'); setSidebarOpen(false); }} className={`w-full flex items-center justify-between px-4 py-3 rounded-xl text-sm font-bold transition-all ${activeTab === 'repairs' ? 'bg-gray-800 text-white shadow-md' : theme === 'dark' ? 'hover:bg-slate-800 text-slate-400' : 'hover:bg-[#E8DFCE] text-gray-600'}`}>
            <div className="flex items-center gap-3"><Wrench size={18} /> Repairs & Operations</div>
            {stats.openRepairs > 0 && (
              <span className="bg-amber-500 text-white text-[10px] px-2 py-0.5 rounded-full font-bold">{stats.openRepairs}</span>
            )}
          </button>
        </nav>
        <div className={`p-4 border-t ${theme === 'dark' ? 'border-slate-800' : 'border-black/5'}`}>
          <button onClick={handleLogout} className="w-full flex items-center gap-2 text-sm font-bold text-gray-500 hover:text-rose-500 hover:bg-rose-500/10 p-3 rounded-xl transition-all">
            <LogOut size={18} /> Secure Sign Out
          </button>
        </div>
      </aside>

      <main className="flex-1 p-6 md:p-8 overflow-y-auto w-full transition-all duration-300 ease-in-out">
        {activeTab === 'dashboard' && role === 'LANDLORD' && (
          <div className="space-y-6 animate-in fade-in duration-500">
            <div className="flex justify-between items-center">
              <h2 className={`text-2xl font-bold ${theme === 'dark' ? 'text-white' : 'text-gray-900'}`}>Landlord Finance Overview</h2>
            </div>
            
            {/* RUJWASCO WATER ACCUMULATION METRICS & Deficit Alerter */}
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
              {houses.map(house => {
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
                        
                        {/* Show if an OCCUPIED house has a complaint logged */}
                        {house.repairStatus === 'NEEDS_REPAIR' && isOccupied && (
                          <div className="bg-rose-500/10 border border-rose-500/20 px-3 py-2 rounded-lg mt-3">
                            <p className={`text-xs font-bold flex items-center gap-1.5 animate-pulse ${theme === 'dark' ? 'text-rose-400' : 'text-rose-600'}`}>
                              <AlertCircle size={14}/> Needs Action (Complaint Logged)
                            </p>
                          </div>
                        )}
                      </div>
                    </div>
                    
                    {/* Landlord Specific Repair Mode Toggle For Vacant Houses */}
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
                  {tenants.map(tenant => {
                    const house = houses.find(h => h.id === tenant.houseId);
                    const owesMoney = (tenant.expectedRent - tenant.paidRent) > 0 || (tenant.expectedWater - tenant.paidWater) > 0;
                    return (
                      <tr key={tenant.id} className={`transition cursor-pointer ${theme === 'dark' ? 'hover:bg-slate-950/40' : 'hover:bg-[#FDFBF7]'}`} onClick={() => setSelectedTenantForDetails(tenant)}>
                        {/* ABSOLUTE FIX: Forced Text Color for Tenant Name in Dark/Light Mode */}
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
                {tenants.map(tenant => {
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
              <h3 className="text-lg font-bold mb-4 font-mono uppercase tracking-wider text-gray-500">Payment Ledger</h3>
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
                    {payments.map(payment => (
                      <tr key={payment.id} className={`transition ${theme === 'dark' ? 'hover:bg-slate-950/40' : 'hover:bg-[#FDFBF7]'}`}>
                        <td className="p-4 text-gray-500 font-medium">{new Date(payment.date).toLocaleDateString()}</td>
                        {/* ABSOLUTE FIX: Forced Text Color for Table Rows in Dark/Light Mode */}
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
                    {repairs.map(repair => {
                      const house = houses.find(h => h.id === repair.houseId);
                      return (
                        <tr key={repair.id} className={`transition ${theme === 'dark' ? 'hover:bg-slate-950/40' : 'hover:bg-[#FDFBF7]'}`}>
                          <td className="p-4 text-gray-500 font-medium">{new Date(repair.date).toLocaleDateString()}</td>
                          {/* ABSOLUTE FIX: Forced Text Color for Repair Rows in Dark/Light Mode */}
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
                        {/* ABSOLUTE FIX: Forced Text Color for Septic Logs in Dark/Light Mode */}
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
      </main>

      {/* ================= STRICT MODALS ================= */}
      
      {/* GLOBAL MODAL ERROR COMPONENT (REUSABLE) */}
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
                    <option>M-Pesa</option><option>Bank Transfer</option><option>Cash</option>
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
          <div className={`rounded-3xl w-full max-w-2xl p-7 shadow-2xl animate-in fade-in zoom-in-95 duration-200 ${theme === 'dark' ? 'bg-slate-900 text-white border border-slate-800' : 'bg-[#FDFBF7] text-gray-900 border border-[#E8DFCE]'}`} onClick={e => e.stopPropagation()}>
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
                  <div key={p.id} className={`flex justify-between items-center p-4 border rounded-2xl transition-all hover:shadow-md ${theme === 'dark' ? 'bg-slate-950 border-slate-800' : 'bg-[#F4EFE6] border-[#DCD4C6]'}`}>
                    <div>
                      <p className={`font-bold text-base ${theme === 'dark' ? 'text-white' : 'text-gray-900'}`}>{p.type === 'COMBINED' ? 'Rent & Water' : p.type} Payment</p>
                      <p className="text-xs text-gray-500 font-semibold mt-1">Logged on: {new Date(p.date).toLocaleDateString()} | Method: {p.method}</p>
                      {p.messageCode && <p className={`text-[10px] font-mono font-bold px-2 py-1 rounded-md inline-block mt-2 border ${theme === 'dark' ? 'bg-white/5 text-gray-300 border-white/10' : 'bg-black/5 text-gray-700 border-black/10'}`}>CODE: {p.messageCode}</p>}
                    </div>
                    <div className="text-right">
                      <p className={`font-black text-lg font-mono ${theme === 'dark' ? 'text-white' : 'text-gray-900'}`}>{formatKes(p.amount)}</p>
                      {p.excessAmount && <p className={`text-[10px] font-bold mt-1.5 uppercase tracking-wider ${theme === 'dark' ? 'text-gray-400' : 'text-gray-600'}`}>Excess: {formatKes(p.excessAmount)}</p>}
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