import {createRoot} from 'react-dom/client';
import App from './App.tsx';
import SetPage from './SetPage.tsx';
import './index.css';

const isSetPage = window.location.pathname.replace(/\/+$/, '') === '/set';
createRoot(document.getElementById('root')!).render(isSetPage ? <SetPage /> : <App />);
