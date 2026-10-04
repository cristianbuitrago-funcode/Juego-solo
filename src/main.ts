import './styles.css';
import { App } from './ui/app';

/**
 * Punto de entrada. En Android (Capacitor) conecta el botón "atrás" del
 * sistema con la navegación del juego.
 */
const root = document.getElementById('app')!;
const app = new App(root);
if (location.hash === '#galeria') void import('./render/gallery').then((m) => m.showGallery(root));
else app.showMenu();

async function bindAndroid(): Promise<void> {
  try {
    const { Capacitor } = await import('@capacitor/core');
    if (!Capacitor.isNativePlatform()) return;
    const { App: CapApp } = await import('@capacitor/app');
    await CapApp.addListener('backButton', () => {
      if (!app.back()) void CapApp.exitApp();
    });
  } catch {
    /* navegador: sin integración nativa */
  }
}
void bindAndroid();

// Acceso de depuración desde la consola del navegador.
(window as unknown as { ecos: App }).ecos = app;
