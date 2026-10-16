/**
 * State of Leonida - PWA In-App Install Prompt Handler
 */

(function() {
    'use strict';

    // Register Service Worker
    if ('serviceWorker' in navigator) {
        window.addEventListener('load', () => {
            navigator.serviceWorker.register('/sw.js').then((reg) => {
                console.log('✅ PWA Service Worker Registered:', reg.scope);
            }).catch((err) => {
                console.warn('PWA SW Registration error:', err);
            });
        });
    }

    let deferredPrompt = null;

    function createInstallBanner() {
        if (localStorage.getItem('pwa_banner_dismissed') === 'true') return;

        const banner = document.createElement('div');
        banner.id = 'pwaInstallBanner';
        banner.style.cssText = `
            position: fixed;
            bottom: 16px;
            left: 16px;
            right: 16px;
            max-width: 440px;
            margin: 0 auto;
            background: rgba(14, 16, 32, 0.95);
            backdrop-filter: blur(14px);
            -webkit-backdrop-filter: blur(14px);
            border: 1px solid rgba(255, 80, 197, 0.4);
            border-radius: 12px;
            padding: 12px 16px;
            display: flex;
            align-items: center;
            justify-content: space-between;
            gap: 12px;
            z-index: 10002;
            box-shadow: 0 10px 40px rgba(0, 0, 0, 0.8), 0 0 20px rgba(255, 80, 197, 0.2);
            animation: pwaSlideUp 0.35s cubic-bezier(0.16, 1, 0.3, 1);
            color: #fff;
            font-family: inherit;
        `;

        banner.innerHTML = `
            <img src="/assets/logos/favicon/web-app-manifest-192x192.png" alt="App Icon" style="width:40px; height:40px; border-radius:8px; flex-shrink:0;">
            <div style="flex:1; min-width:0;">
                <div style="font-size:0.85rem; font-weight:800; color:#fff; white-space:nowrap; overflow:hidden; text-overflow:ellipsis;">Install GTA 6 Map App</div>
                <div style="font-size:0.75rem; color:#8b92aa;">Fast full-screen mapping on mobile</div>
            </div>
            <div style="display:flex; align-items:center; gap:8px; flex-shrink:0;">
                <button id="pwaBtnInstall" style="padding:7px 14px; background:linear-gradient(135deg, #ff50c5, #ff9f43); color:#fff; border:none; border-radius:6px; font-size:0.8rem; font-weight:700; cursor:pointer;">
                    Install
                </button>
                <button id="pwaBtnClose" style="background:none; border:none; color:#8b92aa; font-size:1.1rem; cursor:pointer; padding:4px;">
                    &times;
                </button>
            </div>
        `;

        document.body.appendChild(banner);

        document.getElementById('pwaBtnInstall')?.addEventListener('click', async () => {
            if (deferredPrompt) {
                deferredPrompt.prompt();
                const { outcome } = await deferredPrompt.userChoice;
                if (outcome === 'accepted') {
                    banner.remove();
                }
                deferredPrompt = null;
            } else {
                // iOS fallback instruction
                const tip = document.createElement('div');
                tip.style.cssText = 'position:fixed; top:20px; left:50%; transform:translateX(-50%); background:#0f1123; border:1px solid #ff50c5; color:#fff; padding:12px 20px; border-radius:10px; z-index:10005; font-size:0.85rem; box-shadow:0 10px 30px rgba(0,0,0,0.8); text-align:center; max-width:90%;';
                tip.textContent = 'To install on iPhone/iPad: tap the Share button in Safari, then tap "Add to Home Screen" 📲';
                document.body.appendChild(tip);
                setTimeout(() => tip.remove(), 4000);
                banner.remove();
            }
        });

        document.getElementById('pwaBtnClose')?.addEventListener('click', () => {
            banner.remove();
            localStorage.setItem('pwa_banner_dismissed', 'true');
        });
    }

    window.addEventListener('beforeinstallprompt', (e) => {
        e.preventDefault();
        deferredPrompt = e;
        createInstallBanner();
    });

    // On iOS Safari, display the banner after dwell time if not already standalone
    const isIos = /iPad|iPhone|iPod/.test(navigator.userAgent) && !window.MSStream;
    const isStandalone = window.matchMedia('(display-mode: standalone)').matches || window.navigator.standalone;

    if (isIos && !isStandalone) {
        setTimeout(createInstallBanner, 6000);
    }
})();
