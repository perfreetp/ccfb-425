import './styles.css';
import { App } from './ui/app';

const appEl = document.getElementById('app');
if (!appEl) throw new Error('#app root not found');
new App(appEl);
