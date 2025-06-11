/* global __firebase_config, __app_id, __initial_auth_token, Papa */
import React, { useState, useEffect, useCallback, useMemo } from 'react';
import { initializeApp } from 'firebase/app';
import {
    getAuth,
    signInAnonymously,
    onAuthStateChanged,
    signInWithCustomToken
} from 'firebase/auth';
import {
    getFirestore,
    collection,
    doc,
    addDoc,
    setDoc,
    deleteDoc,
    onSnapshot,
    query,
    writeBatch,
    getDocs,
    orderBy,
    limit,
    where,
    updateDoc
} from 'firebase/firestore';

// --- PapaParse & jsPDF/html2canvas CSV Parser ---
// These scripts will be loaded dynamically by the App component.

// --- Firebase Configuration ---
const firebaseConfig = {
  apiKey: process.env.REACT_APP_API_KEY,
  authDomain: process.env.REACT_APP_AUTH_DOMAIN,
  projectId: process.env.REACT_APP_PROJECT_ID,
  storageBucket: process.env.REACT_APP_STORAGE_BUCKET,
  messagingSenderId: process.env.REACT_APP_MESSAGING_SENDER_ID,
  appId: process.env.REACT_APP_APP_ID
};

// Initialize Firebase
const firebaseApp = initializeApp(firebaseConfig);
const authInstance = getAuth(firebaseApp);
const dbInstance = getFirestore(firebaseApp);
let firebaseInitializationError = null;

try {
    if (typeof __firebase_config !== 'undefined' && __firebase_config) {
        firebaseConfigFromEnv = JSON.parse(__firebase_config);
    } else {
        console.warn("__firebase_config is undefined. Using placeholder.");
        firebaseConfigFromEnv = { apiKey: "FALLBACK", authDomain: "FALLBACK", projectId: "FALLBACK" };
    }
} catch (e) {
    console.error("Error parsing __firebase_config JSON:", e);
    firebaseInitializationError = `Error parsing Firebase config: ${e.message}`;
    firebaseConfigFromEnv = {};
}

if (typeof __app_id !== 'undefined' && __app_id) {
    app_id_from_env = __app_id;
}

// Initialize Firebase
let firebaseApp;
let authInstance;
let dbInstance;

if (!firebaseInitializationError) {
    try {
        firebaseApp = initializeApp(firebaseConfigFromEnv);
        authInstance = getAuth(firebaseApp);
        dbInstance = getFirestore(firebaseApp);
    } catch (error) {
        console.error("FATAL: Firebase initialization failed:", error);
        firebaseInitializationError = `Firebase Core Initialization Failed: ${error.message}.`;
    }
}

// --- Constants (UPDATED)---
const NFHS_WEIGHT_CLASSES = [
    { name: '106', max: 106.0 }, { name: '113', max: 113.0 },
    { name: '120', max: 120.0 }, { name: '126', max: 126.0 },
    { name: '132', max: 132.0 }, { name: '138', max: 138.0 },
    { name: '144', max: 144.0 }, { name: '150', max: 150.0 },
    { name: '157', max: 157.0 }, { name: '165', max: 165.0 },
    { name: '175', max: 175.0 }, { name: '190', max: 190.0 },
    { name: '215', max: 215.0 }, { name: '285', max: 285.0 },
];

const US_STATES = [
  'AL', 'AK', 'AZ', 'AR', 'CA', 'CO', 'CT', 'DE', 'FL', 'GA',
  'HI', 'ID', 'IL', 'IN', 'IA', 'KS', 'KY', 'LA', 'ME', 'MD',
  'MA', 'MI', 'MN', 'MS', 'MO', 'MT', 'NE', 'NV', 'NH', 'NJ',
  'NM', 'NY', 'NC', 'ND', 'OH', 'OK', 'OR', 'PA', 'RI', 'SC',
  'SD', 'TN', 'TX', 'UT', 'VT', 'VA', 'WA', 'WV', 'WI', 'WY'
];
const PREFERRED_STATES = ['NC', 'SC', 'GA', 'TN', 'FL', 'AL'];
const SORTED_STATES = [
  ...PREFERRED_STATES,
  ...US_STATES.filter(s => !PREFERRED_STATES.includes(s)).sort()
];


const getWeightClass = (weight) => {
    if (!weight || weight <= 0) return 'N/A';
    const numWeight = Math.floor(parseFloat(weight));
    for (const wc of NFHS_WEIGHT_CLASSES) {
        if (numWeight <= wc.max) {
            return wc.name;
        }
    }
    return '285+';
};

// --- Helper Components ---
const Modal = ({ children, onClose, title }) => (
    <div className="fixed inset-0 bg-black bg-opacity-50 backdrop-blur-sm flex justify-center items-center p-4 z-50">
        <div className="bg-white p-6 rounded-lg shadow-xl w-full max-w-lg max-h-[90vh] overflow-y-auto">
            <div className="flex justify-between items-center mb-4">
                <h2 className="text-xl font-semibold text-gray-800">{title}</h2>
                <button onClick={onClose} className="text-gray-500 hover:text-gray-700 text-2xl" aria-label="Close modal">&times;</button>
            </div>
            {children}
        </div>
    </div>
);

const LoadingSpinner = ({ message = "Loading..." }) => (
    <div className="flex flex-col justify-center items-center my-4 p-4 text-center">
        <div className="animate-spin rounded-full h-12 w-12 border-t-2 border-b-2 border-yellow-400"></div>
        <p className="text-gray-600 font-medium mt-3">{message}</p>
    </div>
);

const TabButton = ({ label, isActive, onClick }) => (
    <button
        className={`px-3 sm:px-4 py-2 font-medium text-sm rounded-md transition-colors duration-150 focus:outline-none focus:ring-2 focus:ring-yellow-400
            ${isActive ? 'bg-gray-800 text-yellow-400 shadow-md' : 'bg-gray-200 text-gray-700 hover:bg-gray-300'}`}
        onClick={onClick}
    >
        {label}
    </button>
);

// --- Main App Component ---
function App() {
    const [userId, setUserId] = useState(null);
    const [isAuthReady, setIsAuthReady] = useState(false);
    const [appInitializationError, setAppInitializationError] = useState(firebaseInitializationError);
    const [currentPage, setCurrentPage] = useState('dashboard');
    const [notification, setNotification] = useState({ message: '', type: '' });
    
    const [sessions, setSessions] = useState([]);
    const [activeSessionId, setActiveSessionId] = useState(null);
    const [isSessionModalOpen, setIsSessionModalOpen] = useState(false);

    const [wrestlers, setWrestlers] = useState([]);
    const [homeTeams, setHomeTeams] = useState([]);
    const [competitionTeams, setCompetitionTeams] = useState([]);
    const [loading, setLoading] = useState(true);

    const activeSession = useMemo(() => sessions.find(s => s.id === activeSessionId), [sessions, activeSessionId]);
    const allData = { wrestlers, homeTeams, competitionTeams, loading, activeSession };

    useEffect(() => {
        const scripts = [
            { id: 'papaparse-script', src: 'https://cdn.jsdelivr.net/npm/papaparse@5.3.2/papaparse.min.js' },
            { id: 'jspdf-script', src: 'https://cdnjs.cloudflare.com/ajax/libs/jspdf/2.5.1/jspdf.umd.min.js' },
            { id: 'html2canvas-script', src: 'https://cdnjs.cloudflare.com/ajax/libs/html2canvas/1.4.1/html2canvas.min.js' }
        ];
        scripts.forEach(s => {
            if (!document.getElementById(s.id)) {
                const script = document.createElement('script');
                script.id = s.id;
                script.src = s.src;
                script.async = true;
                document.body.appendChild(script);
            }
        });
    }, []);

    useEffect(() => {
        if (appInitializationError || !authInstance) { setIsAuthReady(true); return; }
        const unsubscribe = onAuthStateChanged(authInstance, async (user) => {
            if (user) { setUserId(user.uid); setIsAuthReady(true); } 
            else { try {
                const token = typeof __initial_auth_token !== 'undefined' ? __initial_auth_token : null;
                if (token) await signInWithCustomToken(authInstance, token);
                else await signInAnonymously(authInstance);
            } catch (error) { setAppInitializationError(`Sign-in failed: ${error.message}.`); setIsAuthReady(true); }}
        }, (error) => { setAppInitializationError(`Auth listener error: ${error.message}`); setIsAuthReady(true); });
        return () => unsubscribe();
    }, [appInitializationError]);

    const getUserDataPath = useCallback(() => {
        if (!userId) return null;
        return `artifacts/${app_id_from_env}/users/${userId}`;
    }, [userId]);

    useEffect(() => {
        const userDataPath = getUserDataPath();
        if (!userDataPath) return;
        const sessionsPath = `${userDataPath}/sessions`;
        
        const q = query(collection(dbInstance, sessionsPath), orderBy("createdAt", "desc"));
        const unsubscribe = onSnapshot(q, (snapshot) => {
            const fetchedSessions = snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() }));
            setSessions(fetchedSessions);
            if (!activeSessionId && fetchedSessions.length > 0) {
                setActiveSessionId(fetchedSessions[0].id);
            } else if (activeSessionId && !fetchedSessions.some(s => s.id === activeSessionId)) {
                setActiveSessionId(fetchedSessions[0]?.id || null);
            } else if (fetchedSessions.length === 0 && !isSessionModalOpen) {
                setIsSessionModalOpen(true);
            }
        }, err => {
            console.error("Error fetching sessions:", err);
            showNotification("Error fetching sessions.", 'error');
        });
        return () => unsubscribe();
    }, [userId, activeSessionId, getUserDataPath, isSessionModalOpen]);

    const getCollectionPath = useCallback((collectionName) => {
        if (!activeSessionId || !userId) return null;
        return `${getUserDataPath()}/sessions/${activeSessionId}/${collectionName}`;
    }, [userId, activeSessionId, getUserDataPath]);

    useEffect(() => {
        if (!activeSessionId) {
            setLoading(false);
            setWrestlers([]); setHomeTeams([]); setCompetitionTeams([]);
            return () => {};
        }

        setLoading(true);
        const wrestlersPath = getCollectionPath('wrestlers');
        const homeTeamsPath = getCollectionPath('homeTeams');
        const compTeamsPath = getCollectionPath('competitionTeams');

        let unsubs = [];
        if (wrestlersPath) unsubs.push(onSnapshot(query(collection(dbInstance, wrestlersPath)), (snap) => setWrestlers(snap.docs.map(d => ({id:d.id, ...d.data()}))), err => console.error("Wrestler snapshot error", err)));
        if (homeTeamsPath) unsubs.push(onSnapshot(query(collection(dbInstance, homeTeamsPath)), (snap) => setHomeTeams(snap.docs.map(d => ({id:d.id, ...d.data()}))), err => console.error("HomeTeams snapshot error", err)));
        if (compTeamsPath) unsubs.push(onSnapshot(query(collection(dbInstance, compTeamsPath)), (snap) => {
            setCompetitionTeams(snap.docs.map(d => ({id:d.id, ...d.data()})));
            setLoading(false);
        }, err => {
            console.error("CompTeams snapshot error", err);
            setLoading(false);
        }));
        
        return () => { unsubs.forEach(unsub => unsub()); };
    }, [activeSessionId, getCollectionPath]);

    const showNotification = (message, type = 'success', duration = 4000) => {
        setNotification({ message, type });
        setTimeout(() => setNotification({ message: '', type: '' }), duration);
    };
    
    const handleClearAllData = async () => {
        if (!activeSessionId) return;
        setLoading(true);
        const collectionsToDelete = ['wrestlers', 'homeTeams', 'competitionTeams'];
        const batch = writeBatch(dbInstance);

        for (const collName of collectionsToDelete) {
            const path = getCollectionPath(collName);
            if (!path) continue;
            const snapshot = await getDocs(query(collection(dbInstance, path)));
            snapshot.docs.forEach(doc => batch.delete(doc.ref));
        }

        try { await batch.commit(); showNotification('All data for this session has been cleared.', 'success'); } 
        catch (error) { showNotification(`Error clearing data: ${error.message}`, 'error'); }
        setLoading(false);
    };
    
    const renderPage = () => {
        if (loading && !activeSessionId) return <LoadingSpinner message="Loading Sessions..." />;
        if (loading) return <LoadingSpinner />;
        if (!activeSessionId && sessions.length > 0) return <div className="p-8 text-center"><p>Please select a session to begin.</p></div>
        
        switch(currentPage) {
            case 'dashboard': return <DashboardScreen allData={allData} handleClearAllData={handleClearAllData} db={dbInstance} getUserDataPath={getUserDataPath} showNotification={showNotification} />;
            case 'weighIn': return <WeighInScreen allData={allData} getCollectionPath={getCollectionPath} showNotification={showNotification} db={dbInstance} />;
            case 'homeTeams': return <HomeTeamsScreen allData={allData} getCollectionPath={getCollectionPath} showNotification={showNotification} db={dbInstance} />;
            case 'wrestlers': return <WrestlersScreen allData={allData} getCollectionPath={getCollectionPath} showNotification={showNotification} db={dbInstance} />;
            case 'competitionTeams': return <CompetitionTeamsScreen allData={allData} getCollectionPath={getCollectionPath} showNotification={showNotification} db={dbInstance} />;
            case 'rosterBuilder': return <RosterBuilderScreen allData={allData} getCollectionPath={getCollectionPath} showNotification={showNotification} db={dbInstance} />;
            case 'placeFarmOuts': return <PlaceFarmOutsScreen allData={allData} getCollectionPath={getCollectionPath} showNotification={showNotification} db={dbInstance} />;
            case 'importer': return <CsvImporterScreen allData={allData} getCollectionPath={getCollectionPath} showNotification={showNotification} db={dbInstance} />;
            case 'reports': return <ReportsScreen allData={allData} showNotification={showNotification} />;
            default: return <DashboardScreen allData={allData} handleClearAllData={handleClearAllData} db={dbInstance} getUserDataPath={getUserDataPath} showNotification={showNotification}/>;
        }
    };
    
    if (appInitializationError) return <div className="min-h-screen bg-red-100 flex flex-col justify-center items-center p-6 text-center"><h1 className="text-3xl font-bold text-red-700 mb-4">Application Error</h1><p className="text-red-600 mb-2">Could not initialize the application:</p><p className="text-sm text-red-500 bg-red-50 p-3 rounded-md shadow">{appInitializationError}</p></div>;
    if (!isAuthReady || !userId) return <div className="min-h-screen bg-gray-100 flex flex-col justify-center items-center"><LoadingSpinner message="Authenticating..." /></div>;

    return (
        <div className="min-h-screen bg-gray-900 text-gray-200 font-sans">
            <header className="bg-black text-white p-4 shadow-md flex flex-col md:flex-row justify-between items-center gap-2">
                <h1 className="text-2xl font-bold text-center text-yellow-400">High Country Wrestling Camp</h1>
                <div className="flex items-center gap-2">
                     <select value={activeSessionId || ''} onChange={(e) => setActiveSessionId(e.target.value)} className="bg-gray-800 text-white p-2 rounded-md text-sm border border-yellow-400">
                        <option value="" disabled>-- Select a Session --</option>
                        {sessions.map(s => <option key={s.id} value={s.id}>{s.name}</option>)}
                     </select>
                     <button onClick={() => setIsSessionModalOpen(true)} className="bg-yellow-400 hover:bg-yellow-500 text-black font-semibold py-2 px-3 rounded-md text-sm">Manage Sessions</button>
                </div>
            </header>
            {notification.message && (<div className={`p-3 text-center text-white sticky top-0 z-50 ${notification.type === 'success' ? 'bg-green-500' : 'bg-red-500'}`}>{notification.message}</div>)}
            
            {isSessionModalOpen && <SessionManagerModal db={dbInstance} getUserDataPath={getUserDataPath} sessions={sessions} onClose={() => setIsSessionModalOpen(false)} setActiveSessionId={setActiveSessionId} showNotification={showNotification} />}
            
            {!activeSessionId && !loading && <div className="p-8 text-center text-gray-400"><p>No session selected. Please create or select a session to begin.</p></div>}

            {activeSessionId && (
                <>
                <nav className="bg-gray-800 shadow-sm p-3 mb-6 sticky top-0 z-40">
                    <div className="container mx-auto flex flex-wrap justify-center gap-2">
                        <TabButton label="Dashboard" isActive={currentPage === 'dashboard'} onClick={() => setCurrentPage('dashboard')} />
                        <TabButton label="Weigh-In" isActive={currentPage === 'weighIn'} onClick={() => setCurrentPage('weighIn')} />
                        <TabButton label="Home Teams" isActive={currentPage === 'homeTeams'} onClick={() => setCurrentPage('homeTeams')} />
                        <TabButton label="Wrestlers" isActive={currentPage === 'wrestlers'} onClick={() => setCurrentPage('wrestlers')} />
                        <TabButton label="Comp Teams" isActive={currentPage === 'competitionTeams'} onClick={() => setCurrentPage('competitionTeams')} />
                        <TabButton label="Roster Builder" isActive={currentPage === 'rosterBuilder'} onClick={() => setCurrentPage('rosterBuilder')} />
                        <TabButton label="Place Farm-Outs" isActive={currentPage === 'placeFarmOuts'} onClick={() => setCurrentPage('placeFarmOuts')} />
                        <TabButton label="Import Data" isActive={currentPage === 'importer'} onClick={() => setCurrentPage('importer')} />
                        <TabButton label="Print Reports" isActive={currentPage === 'reports'} onClick={() => setCurrentPage('reports')} />
                    </div>
                </nav>
                <main className="container mx-auto p-4">
                    {renderPage()}
                </main>
                </>
            )}
            <footer className="text-center text-gray-500 text-sm py-8">&copy; {new Date().getFullYear()} High Country Wrestling Camp</footer>
        </div>
    );
}

// --- SessionManagerModal ---
function SessionManagerModal({ db, getUserDataPath, sessions, onClose, setActiveSessionId, showNotification }) {
    const [newSessionName, setNewSessionName] = useState('');
    const [dupeTarget, setDupeTarget] = useState(null);
    const [deleteTarget, setDeleteTarget] = useState(null);
    const [confirmText, setConfirmText] = useState('');
    const sessionsPath = `${getUserDataPath()}/sessions`;

    const handleAddSession = async () => {
        if (!newSessionName.trim() || !sessionsPath) return;
        const newSession = { name: newSessionName.trim(), createdAt: new Date() };
        const docRef = await addDoc(collection(db, sessionsPath), newSession);
        setActiveSessionId(docRef.id);
        setNewSessionName('');
        onClose();
    };

    const handleDeleteSession = async () => {
        if (!deleteTarget || !sessionsPath) return;
        await deleteDoc(doc(db, sessionsPath, deleteTarget));
        setDeleteTarget(null);
        setConfirmText('');
        showNotification('Session deleted. Note: Underlying data must be cleared manually via the dashboard if needed.', 'success', 6000);
    };
    
    const handleDuplicateSession = async (sourceSession, newName) => {
        if (!newName.trim() || !sessionsPath) return showNotification('New session name cannot be empty.', 'error');
        showNotification('Starting duplication... this may take a moment.', 'success');
        
        const newSessionData = { 
            name: newName.trim(), 
            createdAt: new Date(),
            customWeightsDivI: sourceSession.customWeightsDivI || [],
            customWeightsDivII: sourceSession.customWeightsDivII || [],
        };
        const newSessionRef = await addDoc(collection(db, sessionsPath), newSessionData);

        const collectionsToCopy = ['homeTeams', 'wrestlers', 'competitionTeams'];
        for (const collName of collectionsToCopy) {
            const sourcePath = `${getUserDataPath()}/sessions/${sourceSession.id}/${collName}`;
            const destPath = `${getUserDataPath()}/sessions/${newSessionRef.id}/${collName}`;
            const snapshot = await getDocs(query(collection(db, sourcePath)));
            
            let batch = writeBatch(db);
            let count = 0;
            for (const d of snapshot.docs) {
                batch.set(doc(db, destPath, d.id), d.data());
                count++;
                if (count % 499 === 0) {
                    await batch.commit();
                    batch = writeBatch(db);
                }
            }
            if (count % 499 !== 0) {
                 await batch.commit();
            }
        }
        
        showNotification('Duplication complete!', 'success');
        setActiveSessionId(newSessionRef.id);
        onClose();
    };
    
    return (
        <Modal onClose={onClose} title="Manage Sessions">
            <div className="space-y-4 text-gray-800">
                <div>
                    <h3 className="font-semibold mb-2">Existing Sessions</h3>
                    <ul className="space-y-2">
                        {sessions.map(s => (
                            <li key={s.id} className="flex justify-between items-center p-2 bg-gray-100 rounded">
                                <span>{s.name}</span>
                                <div className="space-x-2">
                                    <button onClick={() => setDupeTarget(s)} className="text-blue-500 hover:text-blue-700 text-xs">Duplicate</button>
                                    <button onClick={() => setDeleteTarget(s.id)} className="text-red-500 hover:text-red-700 text-xs">Delete</button>
                                </div>
                            </li>
                        ))}
                    </ul>
                </div>
                 <div>
                    <h3 className="font-semibold mb-2">Create New Session</h3>
                    <div className="flex gap-2">
                        <input type="text" value={newSessionName} onChange={e => setNewSessionName(e.target.value)} className="w-full p-2 border rounded-md" placeholder="e.g., 2025 Camp Session I" />
                        <button onClick={handleAddSession} className="bg-green-500 text-white font-semibold py-2 px-4 rounded-md">Add</button>
                    </div>
                 </div>
            </div>
            {deleteTarget && <Modal onClose={() => setDeleteTarget(null)} title="Confirm Session Deletion">
                <p>This will delete the session entry, but not its underlying data. To confirm, type <strong className="font-mono bg-red-100 px-1 rounded">DELETE</strong> below.</p>
                <input type="text" value={confirmText} onChange={e => setConfirmText(e.target.value)} className="w-full p-2 border rounded-md my-4" />
                <button onClick={handleDeleteSession} disabled={confirmText !== 'DELETE'} className="w-full bg-red-600 text-white font-semibold py-2 px-4 rounded-md disabled:bg-gray-400">Delete Session Entry</button>
            </Modal>}
            {dupeTarget && <Modal onClose={() => setDupeTarget(null)} title={`Duplicate '${dupeTarget.name}'`}>
                <p>Enter a name for the new duplicated session.</p>
                <input type="text" defaultValue={`${dupeTarget.name} - Copy`} onChange={e => setNewSessionName(e.target.value)} className="w-full p-2 border rounded-md my-4" />
                <button onClick={() => handleDuplicateSession(dupeTarget, newSessionName || `${dupeTarget.name} - Copy`)} className="w-full bg-blue-500 text-white font-semibold py-2 px-4 rounded-md">Create Duplicate</button>
            </Modal>}
        </Modal>
    );
}


// --- DashboardScreen ---
function DashboardScreen({ allData, handleClearAllData, db, getUserDataPath, showNotification }) {
    const { wrestlers, homeTeams, competitionTeams, loading, activeSession } = allData;
    const [isClearModalOpen, setIsClearModalOpen] = useState(false);
    const [isWeightModalOpen, setIsWeightModalOpen] = useState(false);
    const [confirmText, setConfirmText] = useState('');
    
    const stats = React.useMemo(() => {
        if (loading || !activeSession) return {};
        const weighedInCount = wrestlers.filter(w => w.actualWeight > 0).length;
        const weighInPercent = wrestlers.length > 0 ? (weighedInCount / wrestlers.length) * 100 : 0;
        const div1Teams = competitionTeams.filter(t => t.division === 'I');
        const div2Teams = competitionTeams.filter(t => t.division === 'II');
        const allWeightsI = [...NFHS_WEIGHT_CLASSES, ...(activeSession.customWeightsDivI || [])].sort((a, b) => a.max - b.max);
        const allWeightsII = [...NFHS_WEIGHT_CLASSES, ...(activeSession.customWeightsDivII || [])].sort((a, b) => a.max - b.max);
        const forfeitsDiv1 = allWeightsI.reduce((acc, wc) => ({ ...acc, [wc.name]: div1Teams.reduce((c, t) => c + (!t.roster?.[wc.name] ? 1 : 0), 0) }), {});
        const forfeitsDiv2 = allWeightsII.reduce((acc, wc) => ({ ...acc, [wc.name]: div2Teams.reduce((c, t) => c + (!t.roster?.[wc.name] ? 1 : 0), 0) }), {});
        const availableFarmOuts = wrestlers.filter(w => w.status === 'FarmOutAvailable');
        const farmOutsDiv1 = availableFarmOuts.filter(w => w.farmOutDivision === 'I').reduce((acc, w) => ({ ...acc, [w.calculatedWeightClass]: (acc[w.calculatedWeightClass] || 0) + 1 }), {});
        const farmOutsDiv2 = availableFarmOuts.filter(w => w.farmOutDivision === 'II').reduce((acc, w) => ({ ...acc, [w.calculatedWeightClass]: (acc[w.calculatedWeightClass] || 0) + 1 }), {});
        
        const homeTeamsWeighInDone = homeTeams.filter(t => t.weighInComplete).length;
        const homeTeamsRosterDone = homeTeams.filter(t => t.rosterComplete).length;
        const homeTeamWeighInPercent = homeTeams.length > 0 ? (homeTeamsWeighInDone / homeTeams.length) * 100 : 0;
        const homeTeamRosterPercent = homeTeams.length > 0 ? (homeTeamsRosterDone / homeTeams.length) * 100 : 0;
        const teamsPendingWeighIn = homeTeams.filter(t => !t.weighInComplete).map(t => t.name).sort();
        const teamsPendingRoster = homeTeams.filter(t => !t.rosterComplete).map(t => t.name).sort();

        return { totalWrestlers: wrestlers.length, homeTeamCount: homeTeams.length, compTeamDiv1Count: div1Teams.length, compTeamDiv2Count: div2Teams.length, weighInPercent: weighInPercent.toFixed(1), femaleCount: wrestlers.filter(w => w.isFemale).length, msCount: wrestlers.filter(w => w.isMiddleSchool).length, forfeitsDiv1, forfeitsDiv2, farmOutsDiv1, farmOutsDiv2, allWeightsI, allWeightsII, div1Teams, div2Teams, homeTeamWeighInPercent: homeTeamWeighInPercent.toFixed(1), homeTeamRosterPercent: homeTeamRosterPercent.toFixed(1), teamsPendingWeighIn, teamsPendingRoster };
    }, [wrestlers, homeTeams, competitionTeams, loading, activeSession]);

    const handleExport = (type) => {
        if (typeof window.Papa === 'undefined') { showNotification("CSV Library not loaded.", 'error'); return; }

        const exportCSV = (data, filename) => {
            const csv = Papa.unparse(data);
            const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
            const link = document.createElement("a");
            const url = URL.createObjectURL(blob);
            link.setAttribute("href", url);
            link.setAttribute("download", filename);
            link.style.visibility = 'hidden';
            document.body.appendChild(link);
            link.click();
            document.body.removeChild(link);
        };
        
        if (type === 'all') {
            exportCSV(homeTeams.map(({id, ...rest}) => rest), 'home-teams-export.csv');
            exportCSV(competitionTeams.map(({id, ...rest}) => rest), 'competition-teams-export.csv');
            exportCSV(wrestlers.map(({id, ...rest}) => rest), 'wrestlers-export.csv');
        } else {
            const dataToExport = wrestlers.filter(w => type === 'Female' ? w.isFemale : w.isMiddleSchool).map(({ name, homeTeamName, actualWeight }) => ({ name, homeTeamName, actualWeight }));
            const filename = type === 'Female' ? 'female-wrestlers.csv' : 'ms-wrestlers.csv';
            exportCSV(dataToExport, filename);
        }
    };
    
    if (loading) return <LoadingSpinner message="Loading Dashboard Data..." />;

    const StatCard = ({ title, value, className }) => (<div className={`p-4 rounded-lg shadow-md ${className}`}><p className="text-sm font-medium opacity-80">{title}</p><p className="text-3xl font-bold">{value}</p></div>);
    const DivisionTable = ({ title, forfeits, farmOuts, weights }) => (<div className="bg-gray-800 p-4 rounded-lg shadow-lg"><h3 className="text-lg font-bold mb-2 text-yellow-400">{title}</h3><div className="overflow-x-auto"><table className="min-w-full text-sm"><thead className="bg-gray-700"><tr><th className="p-2 text-left">Weight</th><th className="p-2 text-center">Forfeits</th><th className="p-2 text-center">Farm-Outs</th></tr></thead><tbody>{(weights || []).map(wc => (<tr key={wc.name} className="border-b border-gray-700"><td className="p-2 font-semibold">{wc.name}</td><td className="p-2 text-center">{forfeits[wc.name] || 0}</td><td className="p-2 text-center">{farmOuts[wc.name] || 0}</td></tr>))}</tbody></table></div></div>);
    const ForfeitByTeamTable = ({ title, teams, weights }) => (<div className="bg-gray-800 p-4 rounded-lg shadow-lg"><h3 className="text-lg font-bold mb-2 text-yellow-400">{title}</h3><div className="overflow-x-auto"><table className="min-w-full text-sm"><thead className="bg-gray-700"><tr><th className="p-2 text-left">Team</th><th className="p-2 text-center">Forfeits</th></tr></thead><tbody>{teams.sort((a,b)=>a.name.localeCompare(b.name)).map(t => (<tr key={t.id} className="border-b border-gray-700"><td className="p-2 font-semibold">{t.name}</td><td className="p-2 text-center">{weights.reduce((c, wc) => c + (!t.roster?.[wc.name] ? 1 : 0), 0)}</td></tr>))}</tbody></table></div></div>);
    const PendingListCard = ({ title, teams, className }) => (
        <div className={`bg-gray-800 p-4 rounded-lg shadow-lg ${className}`}>
            <h3 className="text-lg font-bold mb-3 text-yellow-400">{title}</h3>
            {teams.length > 0 ? (
                <ul className="space-y-1 text-sm list-disc list-inside max-h-40 overflow-y-auto">
                    {teams.map(name => <li key={name}>{name}</li>)}
                </ul>
            ) : (
                <p className="text-sm text-gray-400">All teams complete!</p>
            )}
        </div>
    );

    return (
        <div className="space-y-6">
            <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-6 gap-4">
                <StatCard title="Total Wrestlers" value={stats.totalWrestlers} className="bg-gray-700 text-white" />
                <StatCard title="Home Teams" value={stats.homeTeamCount} className="bg-gray-700 text-white" />
                <StatCard title="Comp Teams (Div I)" value={stats.compTeamDiv1Count} className="bg-gray-700 text-white" />
                <StatCard title="Comp Teams (Div II)" value={stats.compTeamDiv2Count} className="bg-gray-700 text-white" />
                <StatCard title="Female Wrestlers" value={stats.femaleCount} className="bg-pink-500 text-white" />
                <StatCard title="MS Wrestlers" value={stats.msCount} className="bg-indigo-500 text-white" />
            </div>
            <div className="grid md:grid-cols-3 gap-4">
                <div className="bg-gray-800 p-4 rounded-lg shadow-lg"><h3 className="text-lg font-bold mb-2 text-yellow-400">Wrestler Weigh-In Progress</h3><div className="w-full bg-gray-700 rounded-full h-6"><div className="bg-yellow-400 h-6 rounded-full text-center text-black font-bold leading-6" style={{ width: `${stats.weighInPercent}%` }}>{stats.weighInPercent}%</div></div></div>
                <div className="bg-gray-800 p-4 rounded-lg shadow-lg"><h3 className="text-lg font-bold mb-2 text-yellow-400">Team Weigh-In Complete</h3><div className="w-full bg-gray-700 rounded-full h-6"><div className="bg-green-500 h-6 rounded-full text-center text-white font-bold leading-6" style={{ width: `${stats.homeTeamWeighInPercent}%` }}>{stats.homeTeamWeighInPercent}%</div></div></div>
                <div className="bg-gray-800 p-4 rounded-lg shadow-lg"><h3 className="text-lg font-bold mb-2 text-yellow-400">Team Roster Complete</h3><div className="w-full bg-gray-700 rounded-full h-6"><div className="bg-blue-500 h-6 rounded-full text-center text-white font-bold leading-6" style={{ width: `${stats.homeTeamRosterPercent}%` }}>{stats.homeTeamRosterPercent}%</div></div></div>
            </div>
             <div className="grid md:grid-cols-2 gap-6">
                <PendingListCard title="Teams Pending Weigh-In" teams={stats.teamsPendingWeighIn} />
                <PendingListCard title="Teams Pending Roster" teams={stats.teamsPendingRoster} />
            </div>
            <div className="grid md:grid-cols-2 gap-6">
                <ForfeitByTeamTable title="Division I Forfeits by Team" teams={stats.div1Teams} weights={stats.allWeightsI} />
                <ForfeitByTeamTable title="Division II Forfeits by Team" teams={stats.div2Teams} weights={stats.allWeightsII} />
                <DivisionTable title="Division I Overview" forfeits={stats.forfeitsDiv1} farmOuts={stats.farmOutsDiv1} weights={stats.allWeightsI} />
                <DivisionTable title="Division II Overview" forfeits={stats.forfeitsDiv2} farmOuts={stats.farmOutsDiv2} weights={stats.allWeightsII} />
            </div>
             <div className="bg-gray-800 p-4 rounded-lg border border-yellow-400 mt-8 space-y-3">
                <h3 className="text-lg font-bold text-yellow-400">Session Management</h3>
                <div className="flex flex-wrap gap-4">
                    <button onClick={() => setIsWeightModalOpen(true)} className="bg-blue-600 hover:bg-blue-700 text-white font-semibold py-2 px-4 rounded-md">Manage Division Weights</button>
                    <button onClick={() => handleExport('all')} className="bg-blue-600 hover:bg-blue-700 text-white font-semibold py-2 px-4 rounded-md">Export All Data</button>
                    <button onClick={() => handleExport('Female')} className="bg-pink-500 hover:bg-pink-600 text-white font-semibold py-2 px-4 rounded-md">Export Female Wrestlers</button>
                    <button onClick={() => handleExport('MS')} className="bg-indigo-500 hover:bg-indigo-600 text-white font-semibold py-2 px-4 rounded-md">Export MS Wrestlers</button>
                    <button onClick={() => setIsClearModalOpen(true)} className="bg-red-600 hover:bg-red-700 text-white font-semibold py-2 px-4 rounded-md">Clear All Data</button>
                </div>
            </div>
             {isClearModalOpen && (
                <Modal onClose={() => setIsClearModalOpen(false)} title="Confirm Data Deletion">
                    <p className="text-gray-800">This is irreversible. To confirm, please type <strong className="font-mono bg-red-100 px-1 rounded">DELETE</strong> below.</p>
                    <input type="text" value={confirmText} onChange={e => setConfirmText(e.target.value)} className="w-full p-2 border rounded-md my-4 text-black" />
                    <button onClick={() => { handleClearAllData(); setIsClearModalOpen(false); }} disabled={confirmText !== 'DELETE'} className="w-full bg-red-600 text-white font-semibold py-2 px-4 rounded-md disabled:bg-gray-400">Delete All Data</button>
                </Modal>
            )}
            {isWeightModalOpen && <WeightClassManagerModal session={activeSession} db={db} getUserDataPath={getUserDataPath} onClose={() => setIsWeightModalOpen(false)} />}
        </div>
    );
}

// --- WeightClassManagerModal ---
function WeightClassManagerModal({ session, db, getUserDataPath, onClose }) {
    const [weightsI, setWeightsI] = useState(() => (session.customWeightsDivI || []).map(w => ({...w, id: crypto.randomUUID() })));
    const [weightsII, setWeightsII] = useState(() => (session.customWeightsDivII || []).map(w => ({...w, id: crypto.randomUUID() })));
    
    const handleSave = async () => {
        const sessionRef = doc(db, `${getUserDataPath()}/sessions`, session.id);
        const finalWeightsI = weightsI.map(({id, ...rest}) => ({ name: String(rest.max), max: rest.max })).filter(w => w.max > 0);
        const finalWeightsII = weightsII.map(({id, ...rest}) => ({ name: String(rest.max), max: rest.max })).filter(w => w.max > 0);
        await updateDoc(sessionRef, {
            customWeightsDivI: finalWeightsI,
            customWeightsDivII: finalWeightsII,
        });
        onClose();
    };
    
    const DivisionEditor = ({ title, weights, setWeights }) => {
        const add = () => setWeights(prev => [...(prev || []), {id: crypto.randomUUID(), name: '', max: ''}]);
        const remove = (id) => setWeights(prev => prev.filter(w => w.id !== id));
        const update = (id, value) => {
            setWeights(prev => prev.map(w => {
                if (w.id === id) {
                    const newMax = parseFloat(value);
                    return { ...w, max: isNaN(newMax) ? '' : newMax, name: isNaN(newMax) ? '' : value };
                }
                return w;
            }));
        };
        
        return (<div className="p-2 border rounded-md"><h4 className="font-bold">{title}</h4><div className="space-y-2 mt-2">{(weights || []).map((cw) => (
            <div key={cw.id} className="flex gap-2 items-center">
                <input type="number" value={cw.max} onChange={e=>update(cw.id, e.target.value)} placeholder="Max Wt" className="p-1 border rounded w-full" />
                <button onClick={()=>remove(cw.id)} className="text-red-500 font-bold text-2xl">&times;</button>
            </div>
        ))}</div><button onClick={add} className="text-sm mt-2 bg-gray-200 px-2 py-1 rounded">Add Custom Weight</button></div>);
    }
    
    return <Modal onClose={onClose} title="Manage Division Weight Classes">
        <div className="space-y-4 text-gray-800">
            <p className="text-sm text-gray-600">Add custom weight classes for each division. The name will automatically be set from the max weight.</p>
            <div className="grid grid-cols-2 gap-4">
                <DivisionEditor title="Division I" weights={weightsI} setWeights={setWeightsI} />
                <DivisionEditor title="Division II" weights={weightsII} setWeights={setWeightsII} />
            </div>
            <div className="flex justify-end"><button onClick={handleSave} className="bg-green-500 text-white font-semibold py-2 px-4 rounded-md">Save Changes</button></div>
        </div>
    </Modal>
}


// --- WeighInScreen ---
function WeighInScreen({ allData, getCollectionPath, showNotification, db }) {
    const { homeTeams, wrestlers, loading } = allData;
    const [selectedHomeTeamId, setSelectedHomeTeamId] = useState('');
    const [teamWrestlers, setTeamWrestlers] = useState([]);
    const [bulkAction, setBulkAction] = useState('');

    useEffect(() => {
        if (selectedHomeTeamId) {
            const filteredWrestlers = wrestlers
                .filter(w => w.homeTeamId === selectedHomeTeamId)
                .map(w => ({...w, actualWeight: w.actualWeight || ''}));
            setTeamWrestlers(filteredWrestlers);
        } else {
            setTeamWrestlers([]);
        }
    }, [selectedHomeTeamId, wrestlers]);

    const handleWrestlerChange = (id, field, value) => {
        setTeamWrestlers(prev => prev.map(w => w.id === id ? { ...w, [field]: value } : w));
    };
    
    const handleCellSave = async (wrestlerId, field, value) => {
        const wrestlersPath = getCollectionPath('wrestlers');
        if (!wrestlersPath || !db) return;

        let updateData = { [field]: value };
        if (field === 'actualWeight') {
            const numericWeight = parseFloat(value) || 0;
            updateData.actualWeight = numericWeight;
            updateData.calculatedWeightClass = getWeightClass(numericWeight);
        }
        
        try {
            await updateDoc(doc(db, wrestlersPath, wrestlerId), updateData);
            showNotification('Saved!', 'success', 1500);
        } catch (error) {
            showNotification(`Error saving: ${error.message}`, 'error');
        }
    };

    const handleDivisionCheckboxChange = async (id, field, checked) => {
        let updateData = {};
        if (field === 'isFemale') {
            updateData = { isFemale: checked, isMiddleSchool: checked ? false : false };
        } else if (field === 'isMiddleSchool') {
            updateData = { isMiddleSchool: checked, isFemale: checked ? false : false };
        }

        setTeamWrestlers(prev => prev.map(w => (w.id === id ? { ...w, ...updateData } : w)));

        const wrestlersPath = getCollectionPath('wrestlers');
        if (!wrestlersPath || !db) return;
        try {
            await updateDoc(doc(db, wrestlersPath, id), updateData);
            showNotification('Division updated.', 'success', 1500);
        } catch (error) {
            showNotification(`Error saving: ${error.message}`, 'error');
        }
    };
    
    const handleSetFarmOutDivision = async (wrestlerId, division) => {
        const updateData = {
            farmOutDivision: division,
            status: 'FarmOutAvailable',
            isFemale: false,
            isMiddleSchool: false,
        };
        
        setTeamWrestlers(prev => prev.map(w => (w.id === wrestlerId ? { ...w, ...updateData } : w)));

        const wrestlersPath = getCollectionPath('wrestlers');
        if (!wrestlersPath || !db) return;
        try {
            await updateDoc(doc(db, wrestlersPath, wrestlerId), updateData);
            showNotification(`Set as Farm-Out Div ${division}.`, 'success', 1500);
        } catch (error) {
            showNotification(`Error saving: ${error.message}`, 'error');
        }
    };
    
    const handleBulkAction = async () => {
        if (!bulkAction || !selectedHomeTeamId) return;
        const wrestlersToUpdate = teamWrestlers.filter(w => !w.isFemale && !w.isMiddleSchool);
        if (wrestlersToUpdate.length === 0) {
            showNotification('No wrestlers to update.', 'info');
            return;
        }

        let updateData = {};
        if (bulkAction === 'setFemale') {
            updateData = { isFemale: true, isMiddleSchool: false };
        } else if (bulkAction === 'setMS') {
            updateData = { isMiddleSchool: true, isFemale: false };
        }

        const wrestlersPath = getCollectionPath('wrestlers');
        const batch = writeBatch(db);
        wrestlersToUpdate.forEach(w => {
            batch.update(doc(db, wrestlersPath, w.id), updateData);
        });
        
        try {
            await batch.commit();
            showNotification(`Bulk update successful for ${wrestlersToUpdate.length} wrestlers.`, 'success');
        } catch (error) {
            showNotification(`Bulk update failed: ${error.message}`, 'error');
        }
    };

    return (
        <div className="bg-gray-800 p-4 sm:p-6 rounded-lg shadow-lg">
            <h2 className="text-xl sm:text-2xl font-semibold text-yellow-400 mb-4">Team Weigh-In</h2>
            <div className="mb-4">
                 <label className="block text-sm font-medium mb-1">Select Home Team</label>
                 <select value={selectedHomeTeamId} onChange={e => setSelectedHomeTeamId(e.target.value)} className="w-full max-w-md p-2 border rounded-md bg-gray-700 border-gray-600">
                     <option value="">-- Select Team --</option>
                     {homeTeams.sort((a,b)=>a.name.localeCompare(b.name)).map(ht => <option key={ht.id} value={ht.id}>{ht.name}</option>)}
                 </select>
            </div>
            
            {loading && selectedHomeTeamId && <LoadingSpinner />}
            {selectedHomeTeamId && !loading && (
                 <>
                 <div className="my-4 p-3 bg-gray-700 rounded-md flex items-center gap-3">
                    <label className="text-sm font-medium">Bulk Assign Division:</label>
                    <select value={bulkAction} onChange={e => setBulkAction(e.target.value)} className="p-1 text-sm border rounded-md bg-gray-600 border-gray-500">
                        <option value="">-- Select Action --</option>
                        <option value="setFemale">Set as Female</option>
                        <option value="setMS">Set as Middle School</option>
                    </select>
                    <button onClick={handleBulkAction} disabled={!bulkAction} className="bg-yellow-400 hover:bg-yellow-500 text-black font-semibold py-1 px-3 rounded-md text-sm disabled:bg-gray-500 disabled:cursor-not-allowed">Apply</button>
                    <p className="text-xs text-gray-400">Applies only to wrestlers without a division.</p>
                 </div>
                 <div className="overflow-x-auto">
                    <table className="min-w-full divide-y divide-gray-700 text-sm">
                        <thead className="bg-gray-700"><tr>
                            <th className="px-2 py-3 text-left font-medium">Name</th>
                            <th className="px-2 py-3 text-left font-medium">Weight</th>
                            <th className="px-2 py-3 text-center font-medium">Female</th>
                            <th className="px-2 py-3 text-center font-medium">MS</th>
                            <th className="px-2 py-3 text-center font-medium">Farm Out</th>
                        </tr></thead>
                        <tbody className="bg-gray-800 divide-y divide-gray-700">
                            {teamWrestlers.map(w => (
                                <tr key={w.id}>
                                    <td className="px-2 py-2">{w.name}</td>
                                    <td className="px-2 py-2">
                                        <input 
                                            type="number" 
                                            step="0.1" 
                                            value={w.actualWeight} 
                                            onChange={e => handleWrestlerChange(w.id, 'actualWeight', e.target.value)} 
                                            onBlur={e => handleCellSave(w.id, 'actualWeight', e.target.value)}
                                            onKeyDown={e => { if (e.key === 'Enter') { e.preventDefault(); e.target.blur(); } }}
                                            className="w-24 p-1 border rounded-md bg-gray-700 border-gray-600"/>
                                    </td>
                                    <td className="px-2 py-2 text-center">
                                        <input type="checkbox" checked={w.isFemale || false} onChange={e => handleDivisionCheckboxChange(w.id, 'isFemale', e.target.checked)} className="h-4 w-4 rounded bg-gray-600 border-gray-500" />
                                    </td>
                                    <td className="px-2 py-2 text-center">
                                        <input type="checkbox" checked={w.isMiddleSchool || false} onChange={e => handleDivisionCheckboxChange(w.id, 'isMiddleSchool', e.target.checked)} className="h-4 w-4 rounded bg-gray-600 border-gray-500" />
                                    </td>
                                    <td className="px-2 py-2 text-center space-x-1">
                                        <button onClick={() => handleSetFarmOutDivision(w.id, 'I')} className={`text-xs px-2 py-1 rounded ${w.farmOutDivision === 'I' ? 'bg-blue-500 text-white' : 'bg-gray-600'}`}>I</button>
                                        <button onClick={() => handleSetFarmOutDivision(w.id, 'II')} className={`text-xs px-2 py-1 rounded ${w.farmOutDivision === 'II' ? 'bg-blue-500 text-white' : 'bg-gray-600'}`}>II</button>
                                    </td>
                                </tr>
                            ))}
                        </tbody>
                    </table>
                 </div>
                 </>
            )}
        </div>
    );
}

// --- HomeTeamWrestlerManager Component ---
function HomeTeamWrestlerManager({ team, wrestlers, getCollectionPath, showNotification, db }) {
    
    const unassignedWrestlers = useMemo(() => {
        if (!team) return [];
        return wrestlers
            .filter(w => w.homeTeamId === team.id && w.status === 'Unassigned')
            .sort((a,b) => (a.actualWeight || 0) - (b.actualWeight || 0));
    }, [wrestlers, team]);
    
    const handleUpdateWrestler = async (wrestlerId, updateData) => {
        if (!wrestlerId) return;
        const wrestlerRef = doc(db, getCollectionPath('wrestlers'), wrestlerId);
        try {
            await updateDoc(wrestlerRef, updateData);
            showNotification('Wrestler status updated.', 'success', 2000);
        } catch (error) {
            showNotification(`Error updating wrestler: ${error.message}`, 'error');
        }
    };

    return (
        <div className="text-gray-800">
            <h4 className="text-lg font-medium mb-3">Unassigned Wrestlers for {team.name}</h4>
            <div className="overflow-x-auto max-h-96">
                <table className="min-w-full text-sm">
                    <thead className="bg-gray-200 sticky top-0"><tr>
                        <th className="p-2 text-left">Name</th><th className="p-2 text-left">Actions</th>
                    </tr></thead>
                    <tbody className="divide-y divide-gray-100">
                        {unassignedWrestlers.length > 0 ? unassignedWrestlers.map(w => (
                            <tr key={w.id}>
                                <td className="p-2">{w.name} ({w.actualWeight || 'N/A'} lbs)</td>
                                <td className="p-2 flex flex-wrap gap-2">
                                    <button onClick={() => handleUpdateWrestler(w.id, {status: 'FarmOutAvailable', farmOutDivision: 'I'})} className="text-xs bg-purple-200 text-purple-800 px-2 py-1 rounded">Farm Out (Div I)</button>
                                    <button onClick={() => handleUpdateWrestler(w.id, {status: 'FarmOutAvailable', farmOutDivision: 'II'})} className="text-xs bg-purple-200 text-purple-800 px-2 py-1 rounded">Farm Out (Div II)</button>
                                    <button onClick={() => handleUpdateWrestler(w.id, {isFemale: true})} className="text-xs bg-pink-200 text-pink-800 px-2 py-1 rounded">Set Female</button>
                                    <button onClick={() => handleUpdateWrestler(w.id, {isMiddleSchool: true})} className="text-xs bg-indigo-200 text-indigo-800 px-2 py-1 rounded">Set MS</button>
                                </td>
                            </tr>
                        )) : (
                            <tr><td colSpan="2" className="p-4 text-center text-gray-500">No unassigned wrestlers for this team.</td></tr>
                        )}
                    </tbody>
                </table>
            </div>
        </div>
    );
}

// --- HomeTeams Screen ---
function HomeTeamsScreen({ allData, getCollectionPath, showNotification, db }) {
    const { homeTeams, wrestlers, loading } = allData;
    const [isAddEditModalOpen, setIsAddEditModalOpen] = useState(false);
    const [isManageModalOpen, setIsManageModalOpen] = useState(false);
    const [currentTeam, setCurrentTeam] = useState(null);
    const colPath = getCollectionPath('homeTeams');

    const handleOpenAddModal = () => {
        setCurrentTeam({ id: null, name: '', state: 'NC' });
        setIsAddEditModalOpen(true);
    };

    const handleOpenEditModal = (team) => {
        setCurrentTeam(team);
        setIsAddEditModalOpen(true);
    };
    
    const handleOpenManageModal = (team) => {
        setCurrentTeam(team);
        setIsManageModalOpen(true);
    };

    const handleSaveTeam = async () => {
        if (!currentTeam.name.trim() || !colPath || !db) return;
        try {
            const dataToSave = { 
                name: currentTeam.name.trim(),
                state: currentTeam.state || ''
            };
            if (currentTeam.id) {
                 const existingTeam = homeTeams.find(t=>t.id === currentTeam.id);
                 await setDoc(doc(db, colPath, currentTeam.id), { ...existingTeam, ...dataToSave });
            } else {
                 await addDoc(collection(db, colPath), { ...dataToSave, weighInComplete: false, rosterComplete: false });
            }
            showNotification('Home team saved.', 'success');
            setIsAddEditModalOpen(false);
        } catch (error) { showNotification(`Error: ${error.message}`, 'error'); }
    };

    const handleDeleteTeam = async (teamId) => {
        if (!colPath || !db) return;
        if (window.confirm("Are you sure? This is irreversible.")) {
            try { await deleteDoc(doc(db, colPath, teamId)); showNotification('Home team deleted.', 'success'); } 
            catch (error) { showNotification(`Error: ${error.message}`, 'error'); }
        }
    };
    
    const handleCheckboxChange = async (teamId, field, value) => {
        if (!colPath || !db) return;
        try {
            await updateDoc(doc(db, colPath, teamId), { [field]: value });
            showNotification('Status updated.', 'success', 1500);
        } catch (error) {
            showNotification(`Error updating: ${error.message}`, 'error');
        }
    };
    
    const handlePrintTeam = (team) => {
        if (typeof window.jspdf === 'undefined') {
            showNotification("PDF Library not loaded. Please wait and try again.", "error");
            return;
        }
        showNotification('Generating Roster PDF...', 'success');
        const teamWrestlers = wrestlers
            .filter(w => w.homeTeamId === team.id)
            .sort((a,b) => (a.actualWeight || 0) - (b.actualWeight || 0));
            
        const lines = teamWrestlers.map(w => {
            let placement = w.status;
            if (w.status === 'Starter') {
                placement = `${w.competitionTeamName} @ ${w.assignedWeightClassSlot || 'Starter'}`;
            } else if (w.status === 'Reserve') {
                placement = `${w.competitionTeamName} @ Reserve`;
            }
            return `${w.name} (${w.actualWeight || 'N/A'} lbs): ${placement}`;
        });
        
        const { jsPDF } = window.jspdf;
        const pdf = new jsPDF();
        pdf.setFont("helvetica", "bold");
        pdf.setFontSize(16);
        pdf.text(team.name, 10, 20);
        pdf.setFont("helvetica", "normal");
        pdf.setFontSize(12);
        pdf.text(lines, 10, 30);
        pdf.save(`${team.name}-Roster.pdf`);
    };

    return (
        <div className="bg-gray-800 p-4 sm:p-6 rounded-lg shadow-lg">
            <div className="flex flex-col sm:flex-row justify-between items-center mb-6 gap-3">
                <h2 className="text-xl sm:text-2xl font-semibold text-yellow-400">Manage Home Teams</h2>
                <button onClick={handleOpenAddModal} className="bg-yellow-400 hover:bg-yellow-500 text-black font-semibold py-2 px-4 rounded-md shadow-sm w-full sm:w-auto">Add Home Team</button>
            </div>
            {loading ? <LoadingSpinner message="Loading Home Teams..." /> : (
                <div className="overflow-x-auto">
                    <table className="min-w-full divide-y divide-gray-700 text-sm">
                        <thead className="bg-gray-700">
                            <tr>
                                <th className="px-3 py-3 text-left font-medium">Team Name</th>
                                <th className="px-3 py-3 text-center font-medium">Weigh-In Done</th>
                                <th className="px-3 py-3 text-center font-medium">Roster Done</th>
                                <th className="px-3 py-3 text-left font-medium">Actions</th>
                            </tr>
                        </thead>
                        <tbody className="bg-gray-800 divide-y divide-gray-700">
                            {homeTeams.sort((a,b)=>a.name.localeCompare(b.name)).map(team => (
                                <tr key={team.id}>
                                    <td className="px-3 py-3 font-medium">{team.name} {team.state && `(${team.state})`}</td>
                                    <td className="px-3 py-3 text-center">
                                        <input type="checkbox" checked={team.weighInComplete || false} onChange={e => handleCheckboxChange(team.id, 'weighInComplete', e.target.checked)} className="h-4 w-4 rounded bg-gray-600 border-gray-500"/>
                                    </td>
                                    <td className="px-3 py-3 text-center">
                                        <input type="checkbox" checked={team.rosterComplete || false} onChange={e => handleCheckboxChange(team.id, 'rosterComplete', e.target.checked)} className="h-4 w-4 rounded bg-gray-600 border-gray-500"/>
                                    </td>
                                    <td className="px-3 py-3">
                                        <div className="space-x-2 flex-shrink-0">
                                            <button onClick={() => handleOpenManageModal(team)} className="text-sm bg-blue-500 hover:bg-blue-600 text-white py-1 px-3 rounded-md">Manage</button>
                                            <button onClick={() => handlePrintTeam(team)} className="text-sm bg-gray-500 hover:bg-gray-600 text-white py-1 px-3 rounded-md">Print</button>
                                            <button onClick={() => handleOpenEditModal(team)} className="text-sm bg-yellow-500 hover:bg-yellow-600 text-black py-1 px-3 rounded-md">Edit</button>
                                            <button onClick={() => handleDeleteTeam(team.id)} className="text-sm bg-red-500 hover:bg-red-600 text-white py-1 px-3 rounded-md">Delete</button>
                                        </div>
                                    </td>
                                </tr>
                            ))}
                        </tbody>
                    </table>
                </div>
            )}
             {isAddEditModalOpen && currentTeam && (
                <Modal onClose={() => setIsAddEditModalOpen(false)} title={currentTeam.id ? 'Edit Home Team' : 'Add Home Team'}>
                    <div className="space-y-4 text-black">
                        <div>
                            <label className="block text-sm font-medium text-gray-700">Team Name</label>
                            <input type="text" value={currentTeam.name} onChange={(e) => setCurrentTeam({ ...currentTeam, name: e.target.value })} className="w-full p-2 border rounded-md bg-gray-100" placeholder="e.g., Watauga High School" />
                        </div>
                        <div>
                            <label className="block text-sm font-medium text-gray-700">State</label>
                            <select value={currentTeam.state || ''} onChange={(e) => setCurrentTeam({ ...currentTeam, state: e.target.value })} className="w-full p-2 border rounded-md bg-white">
                                <option value="">-- Select State --</option>
                                {SORTED_STATES.map(s => <option key={s} value={s}>{s}</option>)}
                            </select>
                        </div>
                        <div className="flex justify-end space-x-3"><button onClick={() => setIsAddEditModalOpen(false)} className="bg-gray-300 hover:bg-gray-400 text-gray-800 font-semibold py-2 px-4 rounded-md">Cancel</button><button onClick={handleSaveTeam} className="bg-green-500 hover:bg-green-600 text-white font-semibold py-2 px-4 rounded-md">Save</button></div>
                    </div>
                </Modal>
            )}
            {isManageModalOpen && currentTeam && (
                <Modal onClose={() => setIsManageModalOpen(false)} title={`Manage Wrestlers for ${currentTeam.name}`}>
                    <HomeTeamWrestlerManager 
                        team={currentTeam}
                        wrestlers={wrestlers}
                        getCollectionPath={getCollectionPath}
                        showNotification={showNotification}
                        db={db}
                    />
                </Modal>
            )}
        </div>
    );
}


// --- Wrestlers Screen ---
function WrestlersScreen({ allData, getCollectionPath, showNotification, db }) {
    const { homeTeams, wrestlers, loading } = allData;
    const [isModalOpen, setIsModalOpen] = useState(false);
    const initialWrestlerState = { id: null, name: '', actualWeight: '', homeTeamId: '', status: 'Unassigned', calculatedWeightClass: '', isFemale: false, isMiddleSchool: false, farmOutDivision: '' };
    const [currentWrestler, setCurrentWrestler] = useState(initialWrestlerState);
    const [searchTerm, setSearchTerm] = useState('');
    const [filters, setFilters] = useState({ name: '', homeTeamName: '', status: '', calculatedWeightClass: '' });
    const [sortConfig, setSortConfig] = useState({ key: 'name', direction: 'ascending' });
    const wrestlersColPath = getCollectionPath('wrestlers');
    
    const filteredAndSortedWrestlers = useMemo(() => {
        let sortableWrestlers = [...wrestlers];

        sortableWrestlers = sortableWrestlers.filter(w => {
            return Object.keys(filters).every(key => {
                const filterValue = filters[key].toLowerCase();
                if (!filterValue) return true;
                return w[key]?.toString().toLowerCase().includes(filterValue);
            });
        });

        if (searchTerm) {
            sortableWrestlers = sortableWrestlers.filter(w => 
                w.name.toLowerCase().includes(searchTerm.toLowerCase())
            );
        }

        if (sortConfig.key !== null) {
            sortableWrestlers.sort((a, b) => {
                const aVal = a[sortConfig.key] || '';
                const bVal = b[sortConfig.key] || '';
                if (sortConfig.key === 'actualWeight') {
                     return sortConfig.direction === 'ascending' ? (parseFloat(aVal) || 0) - (parseFloat(bVal) || 0) : (parseFloat(bVal) || 0) - (parseFloat(aVal) || 0);
                }
                if (aVal < bVal) {
                    return sortConfig.direction === 'ascending' ? -1 : 1;
                }
                if (aVal > bVal) {
                    return sortConfig.direction === 'ascending' ? 1 : -1;
                }
                return 0;
            });
        }
        
        return sortableWrestlers;
    }, [wrestlers, searchTerm, filters, sortConfig]);

    useEffect(() => { if (isModalOpen) { setCurrentWrestler(cw => ({ ...cw, calculatedWeightClass: getWeightClass(cw.actualWeight) })); } }, [currentWrestler.actualWeight, isModalOpen]);
    useEffect(() => { if(currentWrestler.status !== 'FarmOutAvailable') { setCurrentWrestler(cw => ({...cw, farmOutDivision: ''})); } }, [currentWrestler.status]);

    const handleSaveWrestler = async () => {
        if (!currentWrestler.name.trim() || !currentWrestler.homeTeamId) return showNotification('Name and home team are required.', 'error');
        if (currentWrestler.status === 'FarmOutAvailable' && !currentWrestler.farmOutDivision) return showNotification('Please select a division for the farm-out wrestler.', 'error');
        if (!wrestlersColPath || !db) return;

        const { id, ...wrestlerData } = currentWrestler;
        const selectedHomeTeam = homeTeams.find(ht => ht.id === wrestlerData.homeTeamId);
        wrestlerData.homeTeamName = selectedHomeTeam?.name || '';
        wrestlerData.actualWeight = parseFloat(wrestlerData.actualWeight) || 0;
        wrestlerData.calculatedWeightClass = getWeightClass(wrestlerData.actualWeight);

        if (wrestlerData.status !== 'Starter' && wrestlerData.status !== 'Reserve') { Object.assign(wrestlerData, { competitionTeamId: null, competitionTeamName: null, assignedWeightClassSlot: null }); }

        try {
            if (id) { await setDoc(doc(db, wrestlersColPath, id), wrestlerData); } 
            else { await addDoc(collection(db, wrestlersColPath), wrestlerData); }
            showNotification('Wrestler saved!', 'success');
            resetModal();
        } catch (error) { showNotification(`Error: ${error.message}`, 'error'); }
    };
    
    const handleDivisionCheckboxChange = (field, checked) => {
        if (field === 'isFemale' && checked) {
            setCurrentWrestler(prev => ({ ...prev, isFemale: true, isMiddleSchool: false }));
        } else if (field === 'isMiddleSchool' && checked) {
            setCurrentWrestler(prev => ({ ...prev, isMiddleSchool: true, isFemale: false }));
        } else {
            setCurrentWrestler(prev => ({ ...prev, [field]: checked }));
        }
    };
    
    const resetModal = () => { setIsModalOpen(false); setCurrentWrestler(initialWrestlerState); };
    const openEditModal = (wrestler) => { setCurrentWrestler({ ...initialWrestlerState, ...wrestler, actualWeight: wrestler.actualWeight?.toString() || '' }); setIsModalOpen(true); };
    const handleDeleteWrestler = async (wrestlerId) => {
        if (!wrestlersColPath || !db) return;
        if (window.confirm("Are you sure? This is irreversible.")) {
            try { await deleteDoc(doc(db, wrestlersColPath, wrestlerId)); showNotification('Wrestler deleted.', 'success'); } 
            catch (error) { showNotification(`Error: ${error.message}`, 'error'); }
        }
    };
    
    const getDivisionTags = (w) => {
        let tags = [];
        if (w.isFemale) tags.push({label: 'Female', color: 'bg-pink-100 text-pink-800'});
        if (w.isMiddleSchool) tags.push({label: 'MS', color: 'bg-indigo-100 text-indigo-800'});
        if (w.status === 'FarmOutAvailable' && w.farmOutDivision) tags.push({label: `Farm Div ${w.farmOutDivision}`, color: 'bg-blue-100 text-blue-800'});
        return tags;
    };
    
    const handleFilterChange = (key, value) => {
        setFilters(prev => ({ ...prev, [key]: value }));
    };

    const requestSort = (key) => {
        let direction = 'ascending';
        if (sortConfig.key === key && sortConfig.direction === 'ascending') {
            direction = 'descending';
        }
        setSortConfig({ key, direction });
    };

    const SortableHeader = ({ children, name }) => {
        const icon = sortConfig.key === name 
            ? (sortConfig.direction === 'ascending' ? '▲' : '▼')
            : '↕';
        return <th onClick={() => requestSort(name)} className="px-3 py-3 text-left text-xs font-medium uppercase cursor-pointer select-none">
            {children} <span className="text-yellow-400">{icon}</span>
        </th>
    };

    return (
        <div className="bg-gray-800 p-4 sm:p-6 rounded-lg shadow-lg">
             <div className="flex flex-col sm:flex-row justify-between items-center mb-6 gap-3"><h2 className="text-xl sm:text-2xl font-semibold text-yellow-400">Manage Wrestlers</h2>
                <input type="text" placeholder="Search wrestlers..." value={searchTerm} onChange={e => setSearchTerm(e.target.value)} className="p-2 border rounded-md bg-gray-700 border-gray-600 w-full sm:w-auto" />
                <button onClick={() => { resetModal(); setIsModalOpen(true); }} className="bg-yellow-400 hover:bg-yellow-500 text-black font-semibold py-2 px-4 rounded-md shadow-sm w-full sm:w-auto">Add Wrestler</button>
             </div>
            {loading ? <LoadingSpinner message="Loading Wrestlers..." /> : (
                <div className="overflow-x-auto"><table className="min-w-full divide-y divide-gray-700"><thead className="bg-gray-700">
                    <tr>
                        <SortableHeader name="name">Name</SortableHeader><SortableHeader name="actualWeight">Weight</SortableHeader><SortableHeader name="calculatedWeightClass">Class</SortableHeader><SortableHeader name="homeTeamName">Home Team</SortableHeader><SortableHeader name="status">Status & Division</SortableHeader><th className="px-3 py-3 text-left text-xs font-medium uppercase">Actions</th>
                    </tr>
                    <tr className="bg-gray-700">
                        <td><input onChange={e => handleFilterChange('name', e.target.value)} placeholder="Filter..." className="w-full bg-gray-600 text-white text-xs p-1 rounded"/></td>
                        <td></td>
                        <td><input onChange={e => handleFilterChange('calculatedWeightClass', e.target.value)} placeholder="Filter..." className="w-full bg-gray-600 text-white text-xs p-1 rounded"/></td>
                        <td><input onChange={e => handleFilterChange('homeTeamName', e.target.value)} placeholder="Filter..." className="w-full bg-gray-600 text-white text-xs p-1 rounded"/></td>
                        <td><input onChange={e => handleFilterChange('status', e.target.value)} placeholder="Filter..." className="w-full bg-gray-600 text-white text-xs p-1 rounded"/></td>
                        <td></td>
                    </tr>
                    </thead>
                    <tbody className="bg-gray-800 divide-y divide-gray-700">{filteredAndSortedWrestlers.map(w => {
                        const homeTeam = homeTeams.find(ht => ht.id === w.homeTeamId);
                        const homeTeamDisplay = `${w.homeTeamName || 'N/A'} ${homeTeam?.state ? `(${homeTeam.state})` : ''}`;
                        return (
                        <tr key={w.id}>
                        <td className="px-3 py-3 whitespace-nowrap text-sm">{w.name}</td><td className="px-3 py-3 whitespace-nowrap text-sm">{w.actualWeight || 'N/A'}</td><td className="px-3 py-3 whitespace-nowrap text-sm">{w.calculatedWeightClass}</td><td className="px-3 py-3 whitespace-nowrap text-sm">{homeTeamDisplay}</td>
                        <td className="px-3 py-3 whitespace-nowrap text-sm"><div className="flex items-center gap-2 flex-wrap">
                            <span className={`px-2 inline-flex text-xs leading-5 font-semibold rounded-full ${ w.status === 'Starter' ? 'bg-green-200 text-green-800' : w.status === 'Reserve' ? 'bg-yellow-200 text-yellow-800' : w.status === 'FarmOutAvailable' ? 'bg-blue-200 text-blue-800' : 'bg-gray-600 text-gray-100' }`}>{w.status}</span>
                            {getDivisionTags(w).map(tag => (<span key={tag.label} className={`px-2 inline-flex text-xs leading-5 font-semibold rounded-full ${tag.color}`}>{tag.label}</span>))}</div>
                             { (w.status === 'Starter' || w.status === 'Reserve') && w.competitionTeamName && <span className="text-xs text-gray-400 block truncate max-w-[150px]">({w.competitionTeamName}{w.status === 'Starter' && w.assignedWeightClassSlot ? ` @ ${w.assignedWeightClassSlot}` : ''})</span> }</td>
                        <td className="px-3 py-3 whitespace-nowrap text-sm space-x-2"><button onClick={() => openEditModal(w)} className="text-sm bg-yellow-500 hover:bg-yellow-600 text-black py-1 px-3 rounded-md">Edit</button><button onClick={() => handleDeleteWrestler(w.id)} className="text-sm bg-red-500 hover:bg-red-600 text-white py-1 px-3 rounded-md">Delete</button></td></tr>)})}
                    </tbody></table></div>)}
            {isModalOpen && (<Modal onClose={resetModal} title={currentWrestler.id ? 'Edit Wrestler' : 'Add Wrestler'}><div className="space-y-4 text-black">
                <input type="text" value={currentWrestler.name} onChange={(e) => setCurrentWrestler({ ...currentWrestler, name: e.target.value })} className="w-full p-2 border rounded-md" placeholder="Wrestler Name"/>
                <input type="number" step="0.1" value={currentWrestler.actualWeight} onChange={(e) => setCurrentWrestler({ ...currentWrestler, actualWeight: e.target.value })} className="w-full p-2 border rounded-md" placeholder="Actual Weight (lbs)"/>
                {currentWrestler.actualWeight && <p className="text-sm text-gray-600 mt-1">Calculated Class: <span className="font-semibold">{currentWrestler.calculatedWeightClass}</span></p>}
                <select value={currentWrestler.homeTeamId} onChange={(e) => setCurrentWrestler({ ...currentWrestler, homeTeamId: e.target.value })} className="w-full p-2 border rounded-md bg-white"><option value="">Select Home Team</option>{homeTeams.map(ht => <option key={ht.id} value={ht.id}>{ht.name}</option>)}</select>
                <div className="grid grid-cols-2 gap-4">
                    <label className="flex items-center space-x-2"><input type="checkbox" checked={currentWrestler.isFemale} onChange={e => handleDivisionCheckboxChange('isFemale', e.target.checked)} className="h-4 w-4 rounded" disabled={currentWrestler.status === 'Starter' || currentWrestler.status === 'Reserve'}/><span>Female Division</span></label>
                    <label className="flex items-center space-x-2"><input type="checkbox" checked={currentWrestler.isMiddleSchool} onChange={e => handleDivisionCheckboxChange('isMiddleSchool', e.target.checked)} className="h-4 w-4 rounded" disabled={currentWrestler.status === 'Starter' || currentWrestler.status === 'Reserve'}/><span>Middle School</span></label></div>
                <div><label className="block text-sm font-medium text-gray-700 mb-1">Status</label><select value={currentWrestler.status} onChange={(e) => setCurrentWrestler({ ...currentWrestler, status: e.target.value })} className="w-full p-2 border rounded-md bg-white" disabled={currentWrestler.id && (currentWrestler.status === 'Starter' || currentWrestler.status === 'Reserve')}><option value="Unassigned">Unassigned</option><option value="FarmOutAvailable">Farm Out</option>{currentWrestler.id && (currentWrestler.status === 'Starter' || currentWrestler.status === 'Reserve') && <option value={currentWrestler.status}>{currentWrestler.status} (Assigned)</option>}</select></div>
                {currentWrestler.status === 'FarmOutAvailable' && (<div><label className="block text-sm font-medium text-gray-700 mb-1">Farm Out Division (Required)</label><select value={currentWrestler.farmOutDivision} onChange={e => setCurrentWrestler({...currentWrestler, farmOutDivision: e.target.value})} className="w-full p-2 border rounded-md bg-white"><option value="">Select Division...</option><option value="I">Division I</option><option value="II">Division II</option></select></div>)}
                <div className="flex justify-end space-x-3 pt-2"><button onClick={resetModal} className="bg-gray-300 hover:bg-gray-400 text-gray-800 font-semibold py-2 px-4 rounded-md">Cancel</button><button onClick={handleSaveWrestler} className="bg-green-500 hover:bg-green-600 text-white font-semibold py-2 px-4 rounded-md">Save</button></div></div>
            </Modal>)}
        </div>);
}


// --- CompetitionTeams Screen (UPDATED) ---
function CompetitionTeamsScreen({ allData, getCollectionPath, showNotification, db }) {
    const { competitionTeams, homeTeams, wrestlers, loading, activeSession } = allData;
    const [isModalOpen, setIsModalOpen] = useState(false);
    const initialTeamState = { id: null, name: '', associatedHomeTeamId: '', division: 'I', pool: '', roster: {}, reserves: [] };
    const [currentCompTeam, setCurrentCompTeam] = useState(initialTeamState);
    const compTeamsColPath = getCollectionPath('competitionTeams');

    const handleSaveCompTeam = async () => {
        if (!currentCompTeam.name.trim() || !currentCompTeam.associatedHomeTeamId) return showNotification('Team name and home team are required.', 'error');
        if (!compTeamsColPath || !db) return;
        
        const selectedHomeTeam = homeTeams.find(ht => ht.id === currentCompTeam.associatedHomeTeamId);
        const { id, ...teamData } = {
            ...currentCompTeam,
            associatedHomeTeamName: selectedHomeTeam?.name || '',
            roster: currentCompTeam.id ? currentCompTeam.roster : {},
        };

        try {
            if (id) { await setDoc(doc(db, compTeamsColPath, id), teamData); } 
            else { await addDoc(collection(db, compTeamsColPath), teamData); }
            showNotification('Competition team saved.', 'success');
            setIsModalOpen(false);
        } catch (error) { showNotification(`Error: ${error.message}`, 'error'); }
    };
    
    const handleDeleteCompTeam = async (teamId) => {
        const wrestlersPath = getCollectionPath('wrestlers');
        if (!compTeamsColPath || !wrestlersPath || !db) return;
        if (window.confirm("Are you sure? This will unassign all wrestlers from this team.")) {
            try {
                const batch = writeBatch(db);
                const qWrestlers = query(collection(db, wrestlersPath), where("competitionTeamId", "==", teamId));
                const wrestlerDocs = await getDocs(qWrestlers);
                wrestlerDocs.forEach(wrestlerDoc => { batch.update(doc(db, wrestlersPath, wrestlerDoc.id), { status: 'Unassigned', competitionTeamId: null, competitionTeamName: null, assignedWeightClassSlot: null }); });
                batch.delete(doc(db, compTeamsColPath, teamId));
                await batch.commit();
                showNotification('Competition team and assignments cleared.', 'success');
            } catch (error) { showNotification(`Error: ${error.message}`, 'error'); }
        }
    };
    
    const handlePrintTeam = (team) => {
        if (typeof window.jspdf === 'undefined') {
            showNotification("PDF Library not loaded. Please wait and try again.", "error");
            return;
        }
        showNotification('Generating Roster PDF...', 'success');
        
        const customWeights = team.division === 'I' ? (activeSession.customWeightsDivI || []) : (activeSession.customWeightsDivII || []);
        const allWeights = [...NFHS_WEIGHT_CLASSES, ...customWeights].sort((a, b) => a.max - b.max);
        
        let lines = [];
        allWeights.forEach(wc => {
            const wrestlerId = team.roster?.[wc.name];
            const wrestler = wrestlerId ? wrestlers.find(w => w.id === wrestlerId) : null;
            const isFarmOut = wrestler && wrestler.homeTeamId !== team.associatedHomeTeamId;
            const line = wrestler ? `${wrestler.name} ${isFarmOut ? `(${wrestler.homeTeamName})` : ''}` : 'FORFEIT';
            lines.push(`${wc.name}: ${line}`);
        });

        const { jsPDF } = window.jspdf;
        const pdf = new jsPDF();
        pdf.setFont("helvetica", "bold");
        pdf.setFontSize(16);
        pdf.text(`${team.name} (Div ${team.division})`, 10, 20);
        pdf.setFont("helvetica", "normal");
        pdf.setFontSize(12);
        pdf.text(lines, 10, 30);
        pdf.save(`${team.name}-Roster.pdf`);
    };

    const openEditModal = (team) => {
        setCurrentCompTeam({ ...initialTeamState, ...team });
        setIsModalOpen(true);
    };

    return (
        <div className="bg-gray-800 p-4 sm:p-6 rounded-lg shadow-lg">
            <div className="flex flex-col sm:flex-row justify-between items-center mb-6 gap-3"><h2 className="text-xl sm:text-2xl font-semibold text-yellow-400">Manage Competition Teams</h2><button onClick={() => { setCurrentCompTeam(initialTeamState); setIsModalOpen(true); }} className="bg-yellow-400 hover:bg-yellow-500 text-black font-semibold py-2 px-4 rounded-md shadow-sm w-full sm:w-auto">Add Competition Team</button></div>
             {loading ? <LoadingSpinner message="Loading Teams..." /> : (
                <ul className="space-y-3">{competitionTeams.sort((a,b)=>a.name.localeCompare(b.name)).map(team => {
                    const homeTeam = homeTeams.find(ht => ht.id === team.associatedHomeTeamId);
                    const displayState = homeTeam?.state ? `(${homeTeam.state})` : '';
                    return (
                    <li key={team.id} className="flex flex-col sm:flex-row justify-between items-start sm:items-center p-3 bg-gray-700 rounded-md border-gray-600 border gap-2">
                         <div><span className="font-semibold">{team.name} {displayState}</span><span className="text-sm text-gray-400 block">(Div: {team.division}{team.pool && `, Pool: ${team.pool}`})</span></div>
                        <div className="space-x-2 flex-shrink-0">
                            <button onClick={() => handlePrintTeam(team)} className="text-sm bg-gray-500 hover:bg-gray-600 text-white py-1 px-3 rounded-md">Print</button>
                            <button onClick={() => openEditModal(team)} className="text-sm bg-yellow-500 hover:bg-yellow-600 text-black py-1 px-3 rounded-md">Edit</button>
                            <button onClick={() => handleDeleteCompTeam(team.id)} className="text-sm bg-red-500 hover:bg-red-600 text-white py-1 px-3 rounded-md">Delete</button>
                        </div>
                    </li>)})}</ul>)}
            {isModalOpen && (<Modal onClose={() => setIsModalOpen(false)} title={currentCompTeam.id ? 'Edit Competition Team' : 'Add Competition Team'}><div className="space-y-4 text-black">
                <input type="text" value={currentCompTeam.name} onChange={e => setCurrentCompTeam({...currentCompTeam, name: e.target.value})} className="w-full p-2 border rounded-md" placeholder="Team Name"/>
                <select value={currentCompTeam.associatedHomeTeamId} onChange={e => setCurrentCompTeam({...currentCompTeam, associatedHomeTeamId: e.target.value})} className="w-full p-2 border rounded-md bg-white"><option value="">Select Home Team</option>{homeTeams.map(ht => <option key={ht.id} value={ht.id}>{ht.name}</option>)}</select>
                <div className="grid grid-cols-2 gap-4">
                    <select value={currentCompTeam.division} onChange={e => setCurrentCompTeam({...currentCompTeam, division: e.target.value})} className="w-full p-2 border rounded-md bg-white"><option value="I">Division I</option><option value="II">Division II</option></select>
                     <select value={currentCompTeam.pool || ''} onChange={e => setCurrentCompTeam({...currentCompTeam, pool: e.target.value})} className="w-full p-2 border rounded-md bg-white">
                        <option value="">-- No Pool --</option>
                        <option value="A">Pool A</option>
                        <option value="B">Pool B</option>
                        <option value="C">Pool C</option>
                        <option value="D">Pool D</option>
                    </select>
                </div>
                <div className="flex justify-end space-x-3 pt-2"><button onClick={() => setIsModalOpen(false)} className="bg-gray-300 hover:bg-gray-400 text-gray-800 font-semibold py-2 px-4 rounded-md">Cancel</button><button onClick={handleSaveCompTeam} className="bg-green-500 hover:bg-green-600 text-white font-semibold py-2 px-4 rounded-md">Save</button></div></div>
            </Modal>)}
        </div>);
}

// --- SingleWrestlerWeighInModal ---
function SingleWrestlerWeighInModal({ wrestler, getCollectionPath, db, showNotification, onClose }) {
    const [weight, setWeight] = useState(wrestler.actualWeight || '');

    const handleSave = async () => {
        const wrestlersPath = getCollectionPath('wrestlers');
        if (!wrestlersPath || !db || !wrestler) return;

        const numericWeight = parseFloat(weight) || 0;
        const updateData = {
            actualWeight: numericWeight,
            calculatedWeightClass: getWeightClass(numericWeight)
        };

        try {
            await updateDoc(doc(db, wrestlersPath, wrestler.id), updateData);
            showNotification(`${wrestler.name} weighed in.`, 'success');
            onClose();
        } catch (error) {
            showNotification(`Error saving weight: ${error.message}`, 'error');
        }
    };

    return (
        <Modal onClose={onClose} title={`Weigh-In: ${wrestler.name}`}>
            <div className="space-y-4 text-black">
                <div>
                    <label className="block text-sm font-medium text-gray-700">Actual Weight (lbs)</label>
                    <input
                        type="number"
                        step="0.1"
                        value={weight}
                        onChange={e => setWeight(e.target.value)}
                        className="w-full p-2 border rounded-md"
                        autoFocus
                    />
                </div>
                <div className="flex justify-end space-x-3">
                    <button onClick={onClose} className="bg-gray-300 hover:bg-gray-400 text-gray-800 font-semibold py-2 px-4 rounded-md">Cancel</button>
                    <button onClick={handleSave} className="bg-green-500 hover:bg-green-600 text-white font-semibold py-2 px-4 rounded-md">Save Weight</button>
                </div>
            </div>
        </Modal>
    );
}

// --- RosterBuilder Screen (UPDATED) ---
function RosterBuilderScreen({ allData, getCollectionPath, showNotification, db }) {
    const { competitionTeams, wrestlers, loading, activeSession, homeTeams } = allData;
    const [selectedCompTeamId, setSelectedCompTeamId] = useState('');
    const selectedCompTeam = React.useMemo(() => competitionTeams.find(t => t.id === selectedCompTeamId), [selectedCompTeamId, competitionTeams]);
    const selectedHomeTeam = useMemo(() => {
        if (!selectedCompTeam) return null;
        return homeTeams.find(ht => ht.id === selectedCompTeam.associatedHomeTeamId);
    }, [selectedCompTeam, homeTeams]);
    
    const [isAssignModalOpen, setIsAssignModalOpen] = useState(false);
    const [assignTarget, setAssignTarget] = useState({ type: '', slot: '' }); 
    const [availableWrestlersForSlot, setAvailableWrestlersForSlot] = useState({ home: [], farm: [] });
    const [modalTab, setModalTab] = useState('home');
    const [weighInWrestler, setWeighInWrestler] = useState(null);

    const { weighedInUnassigned, pendingWeighIn } = useMemo(() => {
        if (!selectedCompTeam) return { weighedInUnassigned: [], pendingWeighIn: [] };
        const baseUnassigned = wrestlers.filter(w => w.homeTeamId === selectedCompTeam.associatedHomeTeamId && w.status === 'Unassigned' && !w.isFemale && !w.isMiddleSchool);
        
        const weighedIn = baseUnassigned
            .filter(w => w.actualWeight > 0)
            .sort((a, b) => (a.actualWeight || 0) - (b.actualWeight || 0));

        const pending = baseUnassigned.filter(w => !w.actualWeight || w.actualWeight <= 0);

        return { weighedInUnassigned: weighedIn, pendingWeighIn: pending };
    }, [wrestlers, selectedCompTeam]);

    const handleDeleteWrestler = async (wrestlerId) => {
        const wrestlersPath = getCollectionPath('wrestlers');
        if (!wrestlersPath || !db) return;
        if (window.confirm("Are you sure you want to permanently delete this wrestler?")) {
            try {
                await deleteDoc(doc(db, wrestlersPath, wrestlerId));
                showNotification('Wrestler deleted.', 'success');
            } catch (error) {
                showNotification(`Error deleting wrestler: ${error.message}`, 'error');
            }
        }
    };
    
    const handleUpdateWrestler = async (wrestlerId, updateData) => {
        const batch = writeBatch(db);
        const wrestlerRef = doc(db, getCollectionPath('wrestlers'), wrestlerId);
        
        batch.update(wrestlerRef, updateData);

        if (updateData.status === 'Reserve' && selectedCompTeamId) {
            const compTeamRef = doc(db, getCollectionPath('competitionTeams'), selectedCompTeamId);
            const teamData = competitionTeams.find(t => t.id === selectedCompTeamId);
            if (teamData) {
                const currentReserves = teamData.reserves || [];
                if (!currentReserves.includes(wrestlerId)) {
                    const newReserves = [...currentReserves, wrestlerId];
                    batch.update(compTeamRef, { reserves: newReserves });
                }
            }
        }
        
        try {
            await batch.commit();
            showNotification('Wrestler status updated.', 'success');
        } catch (error) {
            showNotification(`Error updating wrestler: ${error.message}`, 'error');
        }
    };
    
    const handleOpenAssignModal = (type, slot = '') => {
        if (!selectedCompTeam || !activeSession) return;
        setAssignTarget({ type, slot });
        setModalTab('home');

        const currentTeamRoster = selectedCompTeam.roster || {};
        const currentTeamReserves = selectedCompTeam.reserves || [];
        const divCustomWeights = selectedCompTeam.division === 'I' ? (activeSession.customWeightsDivI || []) : (activeSession.customWeightsDivII || []);
        const allCombinedWeights = [...NFHS_WEIGHT_CLASSES, ...divCustomWeights].sort((a,b) => a.max - b.max);
        
        const available = wrestlers.filter(w => {
            if (!w.actualWeight || w.actualWeight <= 0) return false;
            if (w.isFemale || w.isMiddleSchool) return false;
            const isStarterOnThisTeam = Object.values(currentTeamRoster).includes(w.id);
            const isReserveOnThisTeam = currentTeamReserves.includes(w.id);
            if (type === 'starter' && isStarterOnThisTeam && currentTeamRoster[slot] !== w.id) return false;
            if (type === 'reserve' && (isReserveOnThisTeam || isStarterOnThisTeam)) return false;
            return true;
        });

        const weightEligible = (wrestler) => {
            if (type !== 'starter' || !slot) return true;
            const wrestlerWeight = Math.floor(wrestler.actualWeight);
            const wrestlerClassIndex = allCombinedWeights.findIndex(wc => wc.max >= wrestlerWeight);
            const slotIndex = allCombinedWeights.findIndex(wc => wc.name === slot);
            if(slotIndex !== -1 && wrestlerClassIndex !== -1) {
                const indexDiff = slotIndex - wrestlerClassIndex;
                return indexDiff === 0 || indexDiff === 1;
            }
            return false;
        };
        
        const homeWrestlers = available.filter(w => w.homeTeamId === selectedCompTeam.associatedHomeTeamId && (w.status === 'Unassigned' || (w.status === 'Reserve' && w.competitionTeamId === selectedCompTeam.id && type === 'starter')) && weightEligible(w));
        const farmWrestlers = available.filter(w => w.status === 'FarmOutAvailable' && w.farmOutDivision === selectedCompTeam.division && weightEligible(w));

        setAvailableWrestlersForSlot({ home: homeWrestlers, farm: farmWrestlers });
        setIsAssignModalOpen(true);
    };

    const handleAssignWrestler = async (wrestlerId) => {
        const wrestlersColPath = getCollectionPath('wrestlers');
        const compTeamsColPath = getCollectionPath('competitionTeams');
        if (!selectedCompTeam || !wrestlersColPath || !compTeamsColPath || !db) return;
        
        const wrestlerToAssign = wrestlers.find(w => w.id === wrestlerId);
        if (!wrestlerToAssign) return;
        
        const batch = writeBatch(db);
        const compTeamRef = doc(db, compTeamsColPath, selectedCompTeam.id);
        const wrestlerRef = doc(db, wrestlersColPath, wrestlerId);

        let newCompTeamData = JSON.parse(JSON.stringify(selectedCompTeam));
        newCompTeamData.roster = newCompTeamData.roster || {};
        newCompTeamData.reserves = (newCompTeamData.reserves || []).filter(id => id !== wrestlerId);

        let newWrestlerStatusUpdate = { competitionTeamId: selectedCompTeam.id, competitionTeamName: selectedCompTeam.name };

        if (assignTarget.type === 'starter') {
            const slot = assignTarget.slot;
            const currentWrestlerInSlotId = newCompTeamData.roster[slot];
            if (currentWrestlerInSlotId) { 
                 const previousWrestler = wrestlers.find(w => w.id === currentWrestlerInSlotId);
                 let previousWrestlerUpdate = { status: 'Unassigned', competitionTeamId: null, competitionTeamName: null, assignedWeightClassSlot: null };
                 if (previousWrestler && previousWrestler.homeTeamId !== newCompTeamData.associatedHomeTeamId) {
                     previousWrestlerUpdate.status = 'FarmOutAvailable';
                 }
                 batch.update(doc(db, wrestlersColPath, currentWrestlerInSlotId), previousWrestlerUpdate); 
            }
            newCompTeamData.roster[slot] = wrestlerId;
            Object.assign(newWrestlerStatusUpdate, { status: 'Starter', assignedWeightClassSlot: slot });
        } else if (assignTarget.type === 'reserve') {
            if (!newCompTeamData.reserves.includes(wrestlerId)) {
                newCompTeamData.reserves.push(wrestlerId);
            }
            Object.assign(newWrestlerStatusUpdate, { status: 'Reserve', assignedWeightClassSlot: null });
        }

        batch.set(compTeamRef, newCompTeamData); 
        batch.update(wrestlerRef, newWrestlerStatusUpdate);

        try { await batch.commit(); showNotification(`${wrestlerToAssign.name} assigned.`, 'success'); setIsAssignModalOpen(false); } 
        catch (error) { showNotification(`Error: ${error.message}`, 'error'); }
    };
    
    const handleUnassignWrestler = async (type, slotOrWrestlerId) => {
        const wrestlersColPath = getCollectionPath('wrestlers');
        const compTeamsColPath = getCollectionPath('competitionTeams');
        if (!selectedCompTeam || !wrestlersColPath || !compTeamsColPath || !db) return;

        const batch = writeBatch(db);
        const compTeamRef = doc(db, compTeamsColPath, selectedCompTeam.id);
        let newCompTeamData = JSON.parse(JSON.stringify(selectedCompTeam));
        let wrestlerToUnassignId = null;

        if (type === 'starter') {
            wrestlerToUnassignId = newCompTeamData.roster?.[slotOrWrestlerId];
            if (wrestlerToUnassignId) newCompTeamData.roster[slotOrWrestlerId] = null;
        } else {
            wrestlerToUnassignId = slotOrWrestlerId;
            newCompTeamData.reserves = (newCompTeamData.reserves || []).filter(id => id !== wrestlerToUnassignId);
        }
        if (!wrestlerToUnassignId) return;
        
        const wrestlerToUnassign = wrestlers.find(w => w.id === wrestlerToUnassignId);
        let wrestlerUpdateData = { status: 'Unassigned', competitionTeamId: null, competitionTeamName: null, assignedWeightClassSlot: null };
        if (wrestlerToUnassign && wrestlerToUnassign.homeTeamId !== selectedCompTeam.associatedHomeTeamId) {
             wrestlerUpdateData.status = 'FarmOutAvailable';
        } else {
            wrestlerUpdateData.farmOutDivision = '';
        }

        batch.update(doc(db, wrestlersColPath, wrestlerToUnassignId), wrestlerUpdateData);
        batch.set(compTeamRef, newCompTeamData);
        try { await batch.commit(); showNotification('Wrestler unassigned.', 'success');} catch (error) { showNotification(`Error: ${error.message}`, 'error'); }
    };

    const allWeightClassesForTeam = useMemo(() => {
        if (!selectedCompTeam || !activeSession) return NFHS_WEIGHT_CLASSES;
        const customWeights = selectedCompTeam.division === 'I' ? (activeSession.customWeightsDivI || []) : (activeSession.customWeightsDivII || []);
        return [...NFHS_WEIGHT_CLASSES, ...customWeights].sort((a,b) => a.max - b.max);
    }, [selectedCompTeam, activeSession]);
    
    const availableWrestlersBySlot = useMemo(() => {
        if (!selectedCompTeam || !activeSession) return {};
        const availabilityMap = {};
        allWeightClassesForTeam.forEach(wc => {
            const slot = wc.name;
            const available = wrestlers.filter(w => {
                if (!w.actualWeight || w.actualWeight <= 0 || w.isFemale || w.isMiddleSchool) return false;
                const isStarterOnAnotherTeamSlot = Object.values(selectedCompTeam.roster || {}).includes(w.id) && selectedCompTeam.roster[slot] !== w.id;
                return !isStarterOnAnotherTeamSlot;
            });

            const weightEligible = (wrestler) => {
                const wrestlerWeight = Math.floor(wrestler.actualWeight);
                const wrestlerClassIndex = allWeightClassesForTeam.findIndex(wclass => wclass.max >= wrestlerWeight);
                const slotIndex = allWeightClassesForTeam.findIndex(wclass => wclass.name === slot);
                if (slotIndex !== -1 && wrestlerClassIndex !== -1) {
                    const indexDiff = slotIndex - wrestlerClassIndex;
                    return indexDiff === 0 || indexDiff === 1;
                }
                return false;
            };

            const homeWrestlers = available.filter(w => w.homeTeamId === selectedCompTeam.associatedHomeTeamId && w.status !== 'Starter' && weightEligible(w));
            const farmWrestlers = available.filter(w => w.status === 'FarmOutAvailable' && w.farmOutDivision === selectedCompTeam.division && weightEligible(w));
            availabilityMap[slot] = homeWrestlers.length > 0 || farmWrestlers.length > 0;
        });
        return availabilityMap;
    }, [wrestlers, selectedCompTeam, activeSession, allWeightClassesForTeam]);
    
    return (
        <div className="bg-gray-800 p-4 sm:p-6 rounded-lg shadow-lg">
            <h2 className="text-xl sm:text-2xl font-semibold text-yellow-400 mb-4">Roster Builder</h2>
            <div className="mb-6"><select value={selectedCompTeamId} onChange={(e) => setSelectedCompTeamId(e.target.value)} className="w-full max-w-md p-2 border rounded-md shadow-sm bg-gray-700 border-gray-600" disabled={loading}><option value="">-- Select a Team --</option>{competitionTeams.filter(t => t.division === 'I' || t.division === 'II').sort((a,b)=>a.name.localeCompare(b.name)).map(team => (<option key={team.id} value={team.id}>{team.name} (Div: {team.division})</option>))}</select></div>
            
            {weighInWrestler && <SingleWrestlerWeighInModal wrestler={weighInWrestler} getCollectionPath={getCollectionPath} db={db} showNotification={showNotification} onClose={() => setWeighInWrestler(null)} />}

            {loading ? <LoadingSpinner /> : selectedCompTeam && (
                <div>
                    <h3 className="text-xl font-semibold mb-1">{selectedCompTeam.name} Roster</h3>
                    <p className="text-sm text-gray-400 mb-4">Home Team: {selectedHomeTeam?.name} {selectedHomeTeam?.state && `(${selectedHomeTeam.state})`}</p>
                    <div className="mb-8"><h4 className="text-lg font-medium mb-3">Starters</h4><div className="flex flex-col space-y-3">{allWeightClassesForTeam.map(wc => {
                        const wrestlerId = selectedCompTeam.roster?.[wc.name]; const wrestler = wrestlerId ? wrestlers.find(w => w.id === wrestlerId) : null;
                        const isAssignable = availableWrestlersBySlot[wc.name];
                        return (<div key={wc.name} className="p-3 bg-gray-700 rounded-md border-gray-600 border flex flex-col sm:flex-row sm:items-center sm:justify-between gap-2">
                            <p className="font-semibold w-24">{wc.name} lbs</p>
                            <div className="flex-grow">{wrestler ? (<><p className="text-sm text-yellow-300 font-medium">{wrestler.name}</p><p className="text-xs text-gray-400">({wrestler.homeTeamName} - {wrestler.actualWeight || 'N/A'} lbs)</p></>) : <p className="text-sm text-red-400 font-medium">FORFEIT</p>}</div>
                            <div className="flex-shrink-0 flex items-center">{wrestler ? (<button onClick={() => handleUnassignWrestler('starter', wc.name)} className="text-xs bg-red-200 text-red-800 py-1 px-2 rounded-md">Unassign</button>) : (<button onClick={() => handleOpenAssignModal('starter', wc.name)} className="text-sm bg-green-600 hover:bg-green-700 text-white py-1 px-3 rounded-md disabled:bg-gray-500 disabled:cursor-not-allowed" disabled={!isAssignable}>Assign</button>)}
                            {!wrestler && !isAssignable && <span className="text-xs text-gray-400 ml-2">No wrestlers available</span>}
                            </div>
                        </div>);})}</div></div>
                    <div><div className="flex justify-between items-center mb-3 gap-2"><h4 className="text-lg font-medium">Reserves:</h4><button onClick={() => handleOpenAssignModal('reserve')} className="bg-blue-600 hover:bg-blue-700 text-white font-semibold py-1 px-3 rounded-md text-sm">Add Reserve</button></div>
                        {(selectedCompTeam.reserves && selectedCompTeam.reserves.length > 0) ? (<ul className="space-y-2">{selectedCompTeam.reserves.map(wId => { const w = wrestlers.find(wr => wr.id === wId);
                            return (<li key={wId} className="p-3 bg-gray-700 rounded-md border-gray-600 border flex justify-between items-center gap-2"><div><p className="text-sm text-yellow-300 font-medium">{w?.name || 'Unknown'}</p>{w && <p className="text-xs text-gray-400">({w.homeTeamName} - {w.actualWeight || 'N/A'} lbs)</p>}</div><button onClick={() => handleUnassignWrestler('reserve', wId)} className="text-xs bg-red-200 text-red-800 py-1 px-2 rounded-md">Remove</button></li>)})}
                        </ul>) : (<p className="text-sm text-gray-400">No reserves assigned.</p>)}</div>
                    
                    <div className="mt-8">
                        <h4 className="text-lg font-medium mb-3">Available Home Team Wrestlers</h4>
                        <div className="overflow-x-auto">
                            <table className="min-w-full text-sm">
                                <thead className="bg-gray-700"><tr>
                                    <th className="p-2 text-left">Name</th><th className="p-2 text-left">Actions</th>
                                </tr></thead>
                                <tbody className="divide-y divide-gray-700">
                                    {weighedInUnassigned.length > 0 ? weighedInUnassigned.map(w => (
                                        <tr key={w.id}>
                                            <td className="p-2">{w.name} ({w.actualWeight || 'N/A'} lbs)</td>
                                            <td className="p-2 flex flex-wrap gap-2">
                                                <button onClick={() => handleUpdateWrestler(w.id, {status: 'Reserve', competitionTeamId: selectedCompTeam.id, competitionTeamName: selectedCompTeam.name })} className="text-xs bg-blue-200 text-blue-800 px-2 py-1 rounded">Set Reserve</button>
                                                <button onClick={() => handleUpdateWrestler(w.id, {status: 'FarmOutAvailable', farmOutDivision: 'I'})} className="text-xs bg-purple-200 text-purple-800 px-2 py-1 rounded">Farm Out (Div I)</button>
                                                <button onClick={() => handleUpdateWrestler(w.id, {status: 'FarmOutAvailable', farmOutDivision: 'II'})} className="text-xs bg-purple-200 text-purple-800 px-2 py-1 rounded">Farm Out (Div II)</button>
                                                <button onClick={() => handleUpdateWrestler(w.id, {isFemale: true})} className="text-xs bg-pink-200 text-pink-800 px-2 py-1 rounded">Set Female</button>
                                                <button onClick={() => handleUpdateWrestler(w.id, {isMiddleSchool: true})} className="text-xs bg-indigo-200 text-indigo-800 px-2 py-1 rounded">Set MS</button>
                                            </td>
                                        </tr>
                                    )) : (<tr><td colSpan="2" className="p-4 text-center text-gray-400">No available wrestlers with a recorded weight.</td></tr>)}
                                </tbody>
                            </table>
                        </div>
                    </div>

                    <div className="mt-8">
                        <h4 className="text-lg font-medium mb-3 text-red-400">Pending Weigh-In</h4>
                         <div className="overflow-x-auto">
                            <table className="min-w-full text-sm">
                                <thead className="bg-gray-700"><tr>
                                    <th className="p-2 text-left">Name</th><th className="p-2 text-left">Actions</th>
                                </tr></thead>
                                <tbody className="divide-y divide-gray-700">
                                    {pendingWeighIn.length > 0 ? pendingWeighIn.map(w => (
                                        <tr key={w.id}>
                                            <td className="p-2">{w.name}</td>
                                            <td className="p-2 flex flex-wrap gap-2">
                                                <button onClick={() => setWeighInWrestler(w)} className="text-xs bg-yellow-500 text-black px-2 py-1 rounded">Weigh-In</button>
                                                <button onClick={() => handleDeleteWrestler(w.id)} className="text-xs bg-red-600 text-white px-2 py-1 rounded">Delete</button>
                                            </td>
                                        </tr>
                                    )) : (<tr><td colSpan="2" className="p-4 text-center text-gray-400">All wrestlers have been weighed in.</td></tr>)}
                                </tbody>
                            </table>
                        </div>
                    </div>

                </div>)}
             {isAssignModalOpen && selectedCompTeam && (<Modal onClose={() => setIsAssignModalOpen(false)} title={`Assign to ${selectedCompTeam.name}`}>
                <div className="border-b border-gray-200"><nav className="-mb-px flex space-x-4"><button onClick={() => setModalTab('home')} className={`whitespace-nowrap py-2 px-1 border-b-2 font-medium text-sm ${modalTab === 'home' ? 'border-yellow-500 text-yellow-600' : 'border-transparent text-gray-500 hover:text-gray-700 hover:border-gray-300'}`}>From {selectedCompTeam.associatedHomeTeamName}</button><button onClick={() => setModalTab('farm')} className={`whitespace-nowrap py-2 px-1 border-b-2 font-medium text-sm ${modalTab === 'farm' ? 'border-yellow-500 text-yellow-600' : 'border-transparent text-gray-500 hover:text-gray-700 hover:border-gray-300'}`}>Farm-Outs</button></nav></div>
                <ul className="space-y-2 max-h-80 overflow-y-auto pt-4">{availableWrestlersForSlot[modalTab].length > 0 ? availableWrestlersForSlot[modalTab].map(w => (
                    <li key={w.id} className="p-3 border rounded-md hover:bg-gray-100 flex justify-between items-center gap-2 text-black"><div><span className="font-medium text-sm">{w.name}</span><span className="text-xs text-gray-600 block">(Wt: {w.actualWeight || 'N/A'}, Class: {w.calculatedWeightClass || 'N/A'}, From: {w.homeTeamName})</span></div><button onClick={() => handleAssignWrestler(w.id)} className="bg-green-500 hover:bg-green-600 text-white py-1 px-2 rounded-md text-sm flex-shrink-0">Assign</button></li>
                    )) : <p className="text-gray-600 p-4 text-center">No eligible wrestlers found in this category.</p>}</ul>
            </Modal>)}
        </div>
    );
}

// --- PlaceFarmOutsScreen ---
function PlaceFarmOutsScreen({ allData, getCollectionPath, showNotification, db }) {
    const { wrestlers, competitionTeams, activeSession } = allData;
    const [divisionFilter, setDivisionFilter] = useState('All');
    const [selectedWrestler, setSelectedWrestler] = useState(null);

    const farmOuts = wrestlers.filter(w => w.status === 'FarmOutAvailable' && w.actualWeight > 0 && (divisionFilter === 'All' || w.farmOutDivision === divisionFilter));

    const eligibleTeams = useMemo(() => {
        if (!selectedWrestler || !activeSession) return [];
        const divCustomWeights = selectedWrestler.farmOutDivision === 'I' ? (activeSession.customWeightsDivI || []) : (activeSession.customWeightsDivII || []);
        const allDivisionWeights = [...NFHS_WEIGHT_CLASSES, ...divCustomWeights].sort((a,b) => a.max - b.max);
        
        const wrestlerWeight = Math.floor(selectedWrestler.actualWeight);
        const wrestlerClassIndex = allDivisionWeights.findIndex(wc => wc.max >= wrestlerWeight);
        const eligibleWeightClasses = [allDivisionWeights[wrestlerClassIndex]?.name, allDivisionWeights[wrestlerClassIndex + 1]?.name].filter(Boolean);

        return competitionTeams
            .filter(team => team.division === selectedWrestler.farmOutDivision)
            .map(team => {
                const openSlots = eligibleWeightClasses.filter(slotName => !team.roster?.[slotName]);
                const forfeitCount = allDivisionWeights.reduce((count, wc) => count + (!team.roster?.[wc.name] ? 1 : 0), 0);
                return { ...team, openSlots, forfeitCount };
            })
            .filter(team => team.openSlots.length > 0)
            .sort((a,b) => b.forfeitCount - a.forfeitCount);
    }, [selectedWrestler, competitionTeams, activeSession]);

    const handlePlaceWrestler = async (wrestler, teamId, slot) => {
        const wrestlersColPath = getCollectionPath('wrestlers');
        const compTeamsColPath = getCollectionPath('competitionTeams');
        if (!wrestler || !teamId || !slot || !wrestlersColPath || !compTeamsColPath || !db) return;

        const team = competitionTeams.find(t => t.id === teamId);
        if (!team) return;

        const batch = writeBatch(db);
        const teamRef = doc(db, compTeamsColPath, team.id);
        const wrestlerRef = doc(db, wrestlersColPath, wrestler.id);

        let newRoster = { ...(team.roster || {}) };
        newRoster[slot] = wrestler.id;

        batch.update(teamRef, { roster: newRoster });
        batch.update(wrestlerRef, { status: 'Starter', competitionTeamId: team.id, competitionTeamName: team.name, assignedWeightClassSlot: slot });

        try { await batch.commit(); showNotification(`${wrestler.name} placed on ${team.name} at ${slot}.`, 'success'); setSelectedWrestler(null); } 
        catch (error) { showNotification(`Error placing wrestler: ${error.message}`, 'error'); }
    };
    
    return (
        <div className="bg-gray-800 p-4 sm:p-6 rounded-lg shadow-lg">
            <h2 className="text-xl sm:text-2xl font-semibold text-yellow-400 mb-4">Place Available Farm-Outs</h2>
            <div className="flex gap-2 mb-4">
                <button onClick={() => setDivisionFilter('All')} className={`px-3 py-1 text-sm rounded-md ${divisionFilter === 'All' ? 'bg-yellow-400 text-black' : 'bg-gray-700'}`}>All</button>
                <button onClick={() => setDivisionFilter('I')} className={`px-3 py-1 text-sm rounded-md ${divisionFilter === 'I' ? 'bg-yellow-400 text-black' : 'bg-gray-700'}`}>Division I</button>
                <button onClick={() => setDivisionFilter('II')} className={`px-3 py-1 text-sm rounded-md ${divisionFilter === 'II' ? 'bg-yellow-400 text-black' : 'bg-gray-700'}`}>Division II</button>
            </div>
            <div className="overflow-x-auto">
                <table className="min-w-full text-sm">
                    <thead className="bg-gray-700"><tr>
                        <th className="p-2 text-left">Wrestler</th>
                        <th className="p-2 text-left">Actions</th>
                    </tr></thead>
                    <tbody className="divide-y divide-gray-700">
                        {farmOuts.map(w => (
                            <tr key={w.id}>
                                <td className="p-2 align-top w-1/3">
                                    <p className="font-bold">{w.name}</p>
                                    <p className="text-xs text-gray-400">{w.homeTeamName} - {w.actualWeight} lbs (Div {w.farmOutDivision})</p>
                                </td>
                                <td className="p-2 align-top">
                                    <button onClick={() => setSelectedWrestler(w)} className="bg-green-600 text-white px-3 py-1 rounded-md text-xs hover:bg-green-700">Assign...</button>
                                </td>
                            </tr>
                        ))}
                         {farmOuts.length === 0 && (<tr><td colSpan="2" className="p-4 text-center text-gray-400">No farm-outs available for this division.</td></tr>)}
                    </tbody>
                </table>
            </div>
            {selectedWrestler && (
                <Modal onClose={() => setSelectedWrestler(null)} title={`Place ${selectedWrestler.name}`}>
                    <div className="space-y-2 max-h-96 overflow-y-auto border p-2 rounded-md text-black">
                        {eligibleTeams.length > 0 ? eligibleTeams.map(team => (
                            <div key={team.id} className="p-2 bg-gray-100 rounded">
                                <p className="font-bold">{team.name} <span className="font-normal text-sm text-gray-600">({team.forfeitCount} forfeits)</span></p>
                                <div className="flex flex-wrap gap-2 mt-1">
                                    {team.openSlots.map(slot => (<button key={slot} onClick={() => handlePlaceWrestler(selectedWrestler, team.id, slot)} className="text-xs bg-green-500 text-white px-2 py-1 rounded hover:bg-green-600">Place at {slot}</button>))}
                                </div>
                            </div>
                        )) : <p className="text-sm text-gray-500 p-2">No teams with open slots for this wrestler's weight class in Division {selectedWrestler.farmOutDivision}.</p>}
                    </div>
                </Modal>
            )}
        </div>
    );
}

// --- CsvImporterScreen ---
function CsvImporterScreen({ allData, getCollectionPath, showNotification, db }) {
    const { homeTeams } = allData;
    const [file, setFile] = useState(null);
    const [importType, setImportType] = useState('wrestlers');
    const [isImporting, setIsImporting] = useState(false);
    const [previewData, setPreviewData] = useState(null);

    const handleFileChange = (e) => {
        const selectedFile = e.target.files[0];
        setFile(selectedFile);
        if (selectedFile) {
            Papa.parse(selectedFile, {
                preview: 5, header: true, skipEmptyLines: true,
                complete: (results) => setPreviewData(results),
            });
        } else { setPreviewData(null); }
    };

    const handleImport = () => {
        if (!file || isImporting || !db || typeof Papa === 'undefined') return;
        
        setIsImporting(true);
        const homeTeamNameMap = homeTeams.reduce((map, team) => { map[team.name.toLowerCase().trim()] = team.id; return map; }, {});
        
        Papa.parse(file, {
            header: true, skipEmptyLines: true,
            complete: async (results) => {
                const colPath = getCollectionPath(importType);
                if (!colPath) { setIsImporting(false); return showNotification('DB path error.', 'error'); }

                let batch = writeBatch(db);
                const notFoundTeams = new Set();
                let processedCount = 0;
                let batchCount = 0;
                
                for (const row of results.data) {
                    const docRef = doc(collection(db, colPath));
                    let data;
                    if (importType === 'homeTeams' && row.name) {
                        data = { name: row.name.trim(), state: row.state?.trim().toUpperCase() || '' };
                    } else if (importType === 'wrestlers' && row.name && row.homeTeamName) {
                        const homeTeamId = homeTeamNameMap[row.homeTeamName.toLowerCase().trim()];
                        if (!homeTeamId) { notFoundTeams.add(row.homeTeamName); continue; }
                        data = { name: row.name.trim(), homeTeamId, homeTeamName: row.homeTeamName.trim(), actualWeight: parseFloat(row.actualWeight) || 0, status: row.status?.trim() || 'Unassigned', isFemale: row.isFemale?.toLowerCase() === 'true', isMiddleSchool: row.isMiddleSchool?.toLowerCase() === 'true', farmOutDivision: row.farmOutDivision?.trim() || '' };
                        data.calculatedWeightClass = getWeightClass(data.actualWeight);
                    } else if (importType === 'competitionTeams' && row.name && row.associatedHomeTeamName && row.division) {
                        const associatedHomeTeamId = homeTeamNameMap[row.associatedHomeTeamName.toLowerCase().trim()];
                        if (!associatedHomeTeamId) { notFoundTeams.add(row.associatedHomeTeamName); continue; }
                        data = { name: row.name.trim(), associatedHomeTeamId, associatedHomeTeamName: row.associatedHomeTeamName.trim(), division: row.division.trim(), pool: row.pool?.trim().toUpperCase() || '', roster: NFHS_WEIGHT_CLASSES.reduce((acc, wc) => ({ ...acc, [wc.name]: null }), {}), reserves: [] };
                    } else { continue; }
                    batch.set(docRef, data);
                    processedCount++;
                    batchCount++;

                    if (batchCount > 400) {
                        await batch.commit();
                        batch = writeBatch(db);
                        batchCount = 0;
                    }
                }
                
                try { 
                    if (batchCount > 0) await batch.commit();
                    if (notFoundTeams.size > 0) {
                        const failedNames = Array.from(notFoundTeams).join(', ');
                        const availableNames = homeTeams.map(t => t.name).join(', ');
                        if (processedCount === 0) {
                             showNotification(`Import failed. Could not find these teams from your file: [${failedNames}]. Available database teams are: [${availableNames}]. Check for typos or extra spaces.`, 'error', 12000);
                        } else {
                            showNotification(`Import partially completed. ${processedCount} records imported. Could not find these teams: [${failedNames}]`, 'error', 8000);
                        }
                    } else if (processedCount === 0 && results.data.length > 0) {
                        showNotification(`Import failed. 0 records processed. Please check your CSV headers match the required format.`, 'error', 8000);
                    } else if (processedCount > 0) {
                        showNotification(`Import successful! ${processedCount} records imported.`, 'success');
                    } else {
                        showNotification(`No data to import.`, 'info');
                    }
                } 
                catch (err) { showNotification(`Import error: ${err.message}`, 'error'); }
                setIsImporting(false); setFile(null); setPreviewData(null);
            },
            error: (err) => { showNotification(`CSV parsing error: ${err.message}`, 'error'); setIsImporting(false); }
        });
    };
    
    const formats = { 
        homeTeams: { req: "name", opt: "state"}, 
        wrestlers: { req: "name, homeTeamName", opt: "actualWeight, status, isFemale, isMiddleSchool, farmOutDivision" }, 
        competitionTeams: { req: "name, associatedHomeTeamName, division (I or II)", opt: "pool" }
    };

    return (<div className="bg-gray-800 p-4 sm:p-6 rounded-lg shadow-lg"><h2 className="text-xl sm:text-2xl font-semibold text-yellow-400 mb-4">Import Data from CSV</h2><div className="space-y-4">
        <div><label className="block text-sm font-medium mb-1">1. Select Import Type</label><select value={importType} onChange={e => {setImportType(e.target.value); setFile(null); setPreviewData(null);}} className="w-full max-w-md p-2 border rounded-md bg-gray-700 border-gray-600"><option value="homeTeams">Home Teams</option><option value="wrestlers">Wrestlers</option><option value="competitionTeams">Competition Teams</option></select></div>
        <div><p className="text-sm text-gray-300 bg-gray-700 p-2 rounded-md"><span className="font-semibold text-yellow-400">Required Columns:</span> {formats[importType].req}.<br/><span className="font-semibold text-yellow-400">First import Home Teams</span>, then dependent data.<br/><span className="font-semibold text-yellow-400">Optional:</span> {formats[importType].opt || "None"}</p></div>
        <div><label className="block text-sm font-medium mb-1">2. Choose CSV File (Must have headers)</label><input type="file" accept=".csv" onChange={handleFileChange} className="w-full text-sm file:mr-4 file:py-2 file:px-4 file:rounded-md file:border-0 file:text-sm file:font-semibold file:bg-gray-600 file:text-yellow-300 hover:file:bg-gray-500"/></div>
        {previewData && (
            <div className="overflow-x-auto border border-gray-600 rounded-lg"><h3 className="text-md font-semibold p-2 bg-gray-700">File Preview</h3><table className="min-w-full text-xs">
                <thead className="bg-gray-600"><tr>{previewData.meta.fields.map(h => <th key={h} className="p-2 text-left">{h}</th>)}</tr></thead>
                <tbody className="divide-y divide-gray-700">{previewData.data.map((row, i) => <tr key={i}>{previewData.meta.fields.map(h => <td key={h} className="p-2 truncate max-w-xs">{row[h]}</td>)}</tr>)}</tbody>
            </table></div>
        )}
        <button onClick={handleImport} disabled={!file || isImporting} className="w-full max-w-md bg-green-600 text-white font-semibold py-2 px-4 rounded-md disabled:bg-gray-400">{isImporting ? 'Importing...' : 'Start Import'}</button></div></div>);
}

// --- ReportsScreen ---
function ReportsScreen({ allData, showNotification }) {
    const { wrestlers, homeTeams, competitionTeams, loading, activeSession } = allData;
    
    const generatePdf = async (reportName, pages) => {
        if (typeof window.jspdf === 'undefined') {
            showNotification("PDF generation library not loaded yet. Please try again.", "error");
            return;
        }
        showNotification('Generating PDF... please wait.', 'success');

        const { jsPDF } = window.jspdf;
        const pdf = new jsPDF({ orientation: 'p', unit: 'mm', format: 'a4' });
        
        for (let i = 0; i < pages.length; i++) {
            if (i > 0) pdf.addPage();
            const page = pages[i];
            
            pdf.setFont("helvetica", "bold");
            pdf.setFontSize(16);
            pdf.text(page.title, 10, 20);
            
            pdf.setFont("helvetica", "normal");
            pdf.setFontSize(10);
            let y = 30;
            for (const line of page.lines) {
                if (y > 280) {
                    pdf.addPage();
                    y = 20;
                    pdf.setFont("helvetica", "bold");
                    pdf.setFontSize(16);
                    pdf.text(`${page.title} (cont.)`, 10, 15);
                    pdf.setFont("helvetica", "normal");
                    pdf.setFontSize(10);
                }
                pdf.text(line, 10, y);
                y += 7;
            }
        }
        
        pdf.save(`${reportName}.pdf`);
    };

    const handleCompTeamReport = () => {
        const pages = [];
        const allTeams = [...competitionTeams].sort((a,b) => a.name.localeCompare(b.name));
        
        allTeams.forEach(team => {
            const customWeights = team.division === 'I' ? (activeSession.customWeightsDivI || []) : (activeSession.customWeightsDivII || []);
            const allWeights = [...NFHS_WEIGHT_CLASSES, ...customWeights].sort((a, b) => a.max - b.max);
            
            let lines = [];
            allWeights.forEach(wc => {
                const wrestlerId = team.roster?.[wc.name]; const wrestler = wrestlerId ? wrestlers.find(w => w.id === wrestlerId) : null;
                const isFarmOut = wrestler && wrestler.homeTeamId !== team.associatedHomeTeamId;
                const line = `${wc.name}: ${wrestler ? `${wrestler.name} ${isFarmOut ? `(${wrestler.homeTeamName})` : ''}` : 'FORFEIT'}`;
                lines.push(line);
            });
            
            if (team.reserves?.length > 0) {
                lines.push('');
                lines.push('--- Reserves ---');
                const reserveWrestlers = team.reserves.map(rId => wrestlers.find(w => w.id === rId)).filter(Boolean);
                
                const reservesByWeight = reserveWrestlers.reduce((acc, w) => {
                    const wc = w.calculatedWeightClass || 'N/A';
                    if (!acc[wc]) acc[wc] = [];
                    acc[wc].push(w.name);
                    return acc;
                }, {});

                Object.keys(reservesByWeight).sort().forEach(wc => {
                    lines.push(`${wc}: ${reservesByWeight[wc].join(', ')}`);
                });
            }

            pages.push({
                title: `Division ${team.division} - ${team.name}`,
                lines: lines
            });
        });
        generatePdf("Competition-Team-Rosters", pages);
    };
    
    const handleHomeTeamReport = () => {
        const pages = [];
        homeTeams.sort((a,b)=>a.name.localeCompare(b.name)).forEach(ht => {
             let lines = [];
             wrestlers.filter(w => w.homeTeamId === ht.id).sort((a,b) => (a.actualWeight || 0) - (b.actualWeight || 0)).forEach(w => {
                 let placement = w.status;
                 if (w.status === 'Starter') {
                     placement = `${w.competitionTeamName} @ ${w.assignedWeightClassSlot || 'Starter'}`;
                 } else if (w.status === 'Reserve') {
                     placement = `${w.competitionTeamName} @ Reserve`;
                 }
                 lines.push(`${w.name} (${w.actualWeight || 'N/A'} lbs): ${placement}`);
             });
             pages.push({ title: ht.name, lines: lines });
        });
         generatePdf("Home-Team-Placements", pages);
    };

    return (<div className="bg-gray-800 p-4 sm:p-6 rounded-lg shadow-lg"><h2 className="text-xl sm:text-2xl font-semibold text-yellow-400 mb-4">Generate & Print Reports</h2>
        {loading ? <LoadingSpinner message="Loading report data..." /> : (<div className="space-y-3">
            <button onClick={handleCompTeamReport} className="w-full text-left bg-blue-600 text-white font-semibold py-2 px-4 rounded-md hover:bg-blue-700">Competition Team Rosters</button>
            <button onClick={handleHomeTeamReport} className="w-full text-left bg-teal-600 text-white font-semibold py-2 px-4 rounded-md hover:bg-teal-700">Home Team Placement Lists</button>
        </div>)}</div>);
}

export default App;
