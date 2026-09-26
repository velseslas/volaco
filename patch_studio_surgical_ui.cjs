const fs = require('fs');
const path = require('path');

const filePath = path.join(process.cwd(), 'apps', 'studio', 'index.html');
let content = fs.readFileSync(filePath, 'utf8');

// 1. Add generateBakeryApp function
const bakeryAppFunction = `
    function generateBakeryApp() {
      return \`<!DOCTYPE html>
<html lang="fr" class="h-full">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Maison Dupré - Boulangerie & Pâtisserie Artisanale</title>
  <script src="https://cdn.tailwindcss.com"></script>
  <link rel="stylesheet" href="https://cdnjs.cloudflare.com/ajax/libs/font-awesome/6.4.0/css/all.min.css">
  <link rel="preconnect" href="https://fonts.googleapis.com">
  <link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
  <link href="https://fonts.googleapis.com/css2?family=Playfair+Display:ital,wght@0,600;0,700;1,400&family=Plus+Jakarta+Sans:wght@400;500;600;700&display=swap" rel="stylesheet">
  <style>
    body { font-family: 'Plus Jakarta Sans', sans-serif; }
    h1, h2, h3, .font-serif { font-family: 'Playfair Display', serif; }
  </style>
</head>
<body class="bg-[#faf7f2] text-[#2c241e] min-h-full flex flex-col antialiased">
  <!-- Header -->
  <header class="sticky top-0 z-40 bg-[#faf7f2]/95 backdrop-blur-md border-b border-[#e8dfd3]">
    <div class="max-w-6xl mx-auto px-4 sm:px-6 h-20 flex items-center justify-between">
      <div class="flex items-center space-x-3">
        <div class="w-10 h-10 rounded-full bg-[#8c5936] text-[#faf7f2] flex items-center justify-center text-lg shadow-sm">
          <i class="fa-solid fa-wheat-awn"></i>
        </div>
        <div>
          <span class="font-serif text-2xl font-bold tracking-tight text-[#422919]">Maison Dupré</span>
          <span class="block text-[11px] font-medium tracking-widest uppercase text-[#8c5936]">Boulangerie Artisanale • Depuis 1928</span>
        </div>
      </div>

      <nav class="hidden md:flex items-center space-x-8 text-sm font-semibold text-[#665041]">
        <a href="#catalogue" class="hover:text-[#8c5936] transition">Nos Produits</a>
        <a href="#engagements" class="hover:text-[#8c5936] transition">Nos Farines</a>
        <a href="#horaires" class="hover:text-[#8c5936] transition">Horaires & Accès</a>
      </nav>

      <div class="flex items-center space-x-4">
        <div class="hidden sm:flex items-center space-x-2 px-3 py-1.5 rounded-full bg-emerald-50 border border-emerald-200 text-emerald-800 text-xs font-semibold">
          <span class="w-2 h-2 rounded-full bg-emerald-500 animate-pulse"></span>
          <span>Ouvert • Ferme à 19h30</span>
        </div>
        <button onclick="openCartModal()" class="relative p-2.5 rounded-full bg-[#f0e7dc] hover:bg-[#e4d8c8] text-[#422919] transition">
          <i class="fa-solid fa-bag-shopping text-base"></i>
          <span id="cartCount" class="absolute -top-1 -right-1 w-5 h-5 rounded-full bg-[#8c5936] text-white text-[11px] font-bold flex items-center justify-center">0</span>
        </button>
      </div>
    </div>
  </header>

  <!-- Hero Section -->
  <section class="relative overflow-hidden bg-gradient-to-b from-[#f2e7db] to-[#faf7f2] py-16 sm:py-24 border-b border-[#e8dfd3]">
    <div class="max-w-6xl mx-auto px-4 sm:px-6">
      <div class="grid grid-cols-1 lg:grid-cols-12 gap-12 items-center">
        <div class="lg:col-span-7 space-y-6 text-center lg:text-left">
          <div class="inline-flex items-center space-x-2 px-3.5 py-1.5 rounded-full bg-[#e8dacb] text-[#5c3a23] text-xs font-bold uppercase tracking-wider">
            <i class="fa-solid fa-award"></i>
            <span>Pain au levain naturel & farine Label Rouge</span>
          </div>
          <h1 class="text-4xl sm:text-5xl lg:text-6xl font-bold tracking-tight text-[#3b2314] leading-[1.15]">
            Le goût du pain cuit sur pierre chaque matin.
          </h1>
          <p class="text-lg text-[#6e5543] max-w-xl mx-auto lg:mx-0 leading-relaxed font-normal">
            Pains de campagne traditionnels, baguettes de tradition française au levain vivant et viennoiseries pur beurre AOP façonnées à la main.
          </p>
          <div class="flex flex-col sm:flex-row items-center justify-center lg:justify-start gap-4 pt-2">
            <a href="#catalogue" class="w-full sm:w-auto px-7 py-3.5 rounded-xl bg-[#8c5936] hover:bg-[#724527] text-white font-bold text-sm shadow-md hover:shadow-lg transition flex items-center justify-center space-x-2">
              <i class="fa-solid fa-basket-shopping"></i>
              <span>Découvrir la fournée</span>
            </a>
            <a href="#horaires" class="w-full sm:w-auto px-7 py-3.5 rounded-xl bg-white hover:bg-[#f0e7dc] border border-[#d6c7b6] text-[#4a3221] font-semibold text-sm transition flex items-center justify-center space-x-2">
              <i class="fa-regular fa-clock"></i>
              <span>Voir les horaires du fournil</span>
            </a>
          </div>
        </div>

        <div class="lg:col-span-5 relative">
          <div class="relative mx-auto max-w-md rounded-3xl overflow-hidden shadow-2xl border-4 border-white bg-[#e4d6c4]">
            <img src="https://images.unsplash.com/photo-1509440159596-0249088772ff?auto=format&fit=crop&w=800&q=80" alt="Pains traditionnels frais du fournil" class="w-full h-80 sm:h-96 object-cover transform hover:scale-105 transition duration-700">
            <div class="absolute inset-0 bg-gradient-to-t from-black/60 via-transparent to-transparent flex items-end p-6">
              <div class="text-white space-y-1">
                <span class="text-xs font-mono uppercase tracking-widest text-[#f5d9be]">Fournée du jour</span>
                <div class="text-xl font-serif font-bold">Tradition Française au Levain</div>
                <p class="text-xs text-white/80">Farine T65 sans additif, fermentation lente 24h</p>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  </section>

  <!-- Product Catalog Section -->
  <section id="catalogue" class="py-16 sm:py-24 max-w-6xl mx-auto px-4 sm:px-6 flex-1 w-full">
    <div class="flex flex-col md:flex-row md:items-end justify-between mb-10 pb-6 border-b border-[#e8dfd3] gap-6">
      <div class="space-y-2">
        <span class="text-xs font-bold uppercase tracking-widest text-[#8c5936]">Notre Fournil</span>
        <h2 class="text-3xl sm:text-4xl font-bold text-[#3b2314]">Catalogue des Produits Frais</h2>
        <p class="text-sm text-[#735b49]">Sélectionnez vos douceurs et pains artisanaux pour un retrait direct en boutique.</p>
      </div>

      <!-- Categories Filter Tabs -->
      <div class="flex flex-wrap gap-2">
        <button onclick="filterCategory('all')" id="btn-all" class="cat-btn px-4 py-2 rounded-xl text-xs font-bold transition bg-[#8c5936] text-white">Tous</button>
        <button onclick="filterCategory('pain')" id="btn-pain" class="cat-btn px-4 py-2 rounded-xl text-xs font-bold transition bg-white border border-[#d6c7b6] text-[#594232] hover:bg-[#f0e7dc]">Pains Traditionnels</button>
        <button onclick="filterCategory('viennoiserie')" id="btn-viennoiserie" class="cat-btn px-4 py-2 rounded-xl text-xs font-bold transition bg-white border border-[#d6c7b6] text-[#594232] hover:bg-[#f0e7dc]">Viennoiseries</button>
        <button onclick="filterCategory('patisserie')" id="btn-patisserie" class="cat-btn px-4 py-2 rounded-xl text-xs font-bold transition bg-white border border-[#d6c7b6] text-[#594232] hover:bg-[#f0e7dc]">Pâtisseries</button>
      </div>
    </div>

    <!-- Products Grid -->
    <div class="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-6" id="productsGrid">
      <!-- Item 1 -->
      <div class="product-card bg-white border border-[#e8dfd3] rounded-2xl overflow-hidden shadow-sm hover:shadow-md transition flex flex-col" data-category="pain">
        <div class="h-48 overflow-hidden bg-[#e8dfd3] relative">
          <img src="https://images.unsplash.com/photo-1549931319-a545dcf3bc73?auto=format&fit=crop&w=600&q=80" alt="Baguette Tradition" class="w-full h-full object-cover">
          <span class="absolute top-3 left-3 px-2.5 py-1 rounded-md bg-[#8c5936]/90 text-white text-[10px] font-bold uppercase tracking-wider">Best-Seller</span>
        </div>
        <div class="p-5 flex-1 flex flex-col justify-between space-y-4">
          <div>
            <div class="flex justify-between items-start">
              <h3 class="font-serif text-lg font-bold text-[#3b2314]">Baguette Tradition Label Rouge</h3>
              <span class="font-bold text-sm text-[#8c5936] ml-2">1,35 €</span>
            </div>
            <p class="text-xs text-[#735b49] mt-1 leading-relaxed">Croûte dorée croustillante, mie alvéolée et crème, sel de Guérande.</p>
          </div>
          <button onclick="addToCart('Baguette Tradition', 1.35)" class="w-full py-2.5 rounded-xl bg-[#faf4ec] hover:bg-[#8c5936] text-[#594232] hover:text-white font-bold text-xs border border-[#decbb7] transition flex items-center justify-center space-x-2">
            <i class="fa-solid fa-plus text-[10px]"></i>
            <span>Ajouter au panier</span>
          </button>
        </div>
      </div>

      <!-- Item 2 -->
      <div class="product-card bg-white border border-[#e8dfd3] rounded-2xl overflow-hidden shadow-sm hover:shadow-md transition flex flex-col" data-category="pain">
        <div class="h-48 overflow-hidden bg-[#e8dfd3] relative">
          <img src="https://images.unsplash.com/photo-1586444248902-2f64eddc13df?auto=format&fit=crop&w=600&q=80" alt="Pain de Campagne" class="w-full h-full object-cover">
          <span class="absolute top-3 left-3 px-2.5 py-1 rounded-md bg-emerald-800/90 text-white text-[10px] font-bold uppercase tracking-wider">Bio</span>
        </div>
        <div class="p-5 flex-1 flex flex-col justify-between space-y-4">
          <div>
            <div class="flex justify-between items-start">
              <h3 class="font-serif text-lg font-bold text-[#3b2314]">Pain de Campagne au Levain</h3>
              <span class="font-bold text-sm text-[#8c5936] ml-2">3,80 €</span>
            </div>
            <p class="text-xs text-[#735b49] mt-1 leading-relaxed">Miche de 500g, farine de meule T80 bio et seigle, excellente conservation.</p>
          </div>
          <button onclick="addToCart('Pain de Campagne', 3.80)" class="w-full py-2.5 rounded-xl bg-[#faf4ec] hover:bg-[#8c5936] text-[#594232] hover:text-white font-bold text-xs border border-[#decbb7] transition flex items-center justify-center space-x-2">
            <i class="fa-solid fa-plus text-[10px]"></i>
            <span>Ajouter au panier</span>
          </button>
        </div>
      </div>

      <!-- Item 3 -->
      <div class="product-card bg-white border border-[#e8dfd3] rounded-2xl overflow-hidden shadow-sm hover:shadow-md transition flex flex-col" data-category="viennoiserie">
        <div class="h-48 overflow-hidden bg-[#e8dfd3] relative">
          <img src="https://images.unsplash.com/photo-1555507036-ab1f4038808a?auto=format&fit=crop&w=600&q=80" alt="Croissant Pur Beurre" class="w-full h-full object-cover">
        </div>
        <div class="p-5 flex-1 flex flex-col justify-between space-y-4">
          <div>
            <div class="flex justify-between items-start">
              <h3 class="font-serif text-lg font-bold text-[#3b2314]">Croissant Pur Beurre AOP</h3>
              <span class="font-bold text-sm text-[#8c5936] ml-2">1,50 €</span>
            </div>
            <p class="text-xs text-[#735b49] mt-1 leading-relaxed">Feuilletage caramélisé, beurre de Charentes-Poitou AOP, croustillant incomparable.</p>
          </div>
          <button onclick="addToCart('Croissant Pur Beurre', 1.50)" class="w-full py-2.5 rounded-xl bg-[#faf4ec] hover:bg-[#8c5936] text-[#594232] hover:text-white font-bold text-xs border border-[#decbb7] transition flex items-center justify-center space-x-2">
            <i class="fa-solid fa-plus text-[10px]"></i>
            <span>Ajouter au panier</span>
          </button>
        </div>
      </div>

      <!-- Item 4 -->
      <div class="product-card bg-white border border-[#e8dfd3] rounded-2xl overflow-hidden shadow-sm hover:shadow-md transition flex flex-col" data-category="viennoiserie">
        <div class="h-48 overflow-hidden bg-[#e8dfd3] relative">
          <img src="https://images.unsplash.com/photo-1608198093002-ad4e005484ec?auto=format&fit=crop&w=600&q=80" alt="Pain au Chocolat" class="w-full h-full object-cover">
        </div>
        <div class="p-5 flex-1 flex flex-col justify-between space-y-4">
          <div>
            <div class="flex justify-between items-start">
              <h3 class="font-serif text-lg font-bold text-[#3b2314]">Pain au Chocolat Valrhona</h3>
              <span class="font-bold text-sm text-[#8c5936] ml-2">1,65 €</span>
            </div>
            <p class="text-xs text-[#735b49] mt-1 leading-relaxed">Deux barres de chocolat noir 64% pur beurre de cacao dans un feuilletage fondant.</p>
          </div>
          <button onclick="addToCart('Pain au Chocolat', 1.65)" class="w-full py-2.5 rounded-xl bg-[#faf4ec] hover:bg-[#8c5936] text-[#594232] hover:text-white font-bold text-xs border border-[#decbb7] transition flex items-center justify-center space-x-2">
            <i class="fa-solid fa-plus text-[10px]"></i>
            <span>Ajouter au panier</span>
          </button>
        </div>
      </div>

      <!-- Item 5 -->
      <div class="product-card bg-white border border-[#e8dfd3] rounded-2xl overflow-hidden shadow-sm hover:shadow-md transition flex flex-col" data-category="patisserie">
        <div class="h-48 overflow-hidden bg-[#e8dfd3] relative">
          <img src="https://images.unsplash.com/photo-1519869325930-281384150729?auto=format&fit=crop&w=600&q=80" alt="Éclair Chocolat" class="w-full h-full object-cover">
        </div>
        <div class="p-5 flex-1 flex flex-col justify-between space-y-4">
          <div>
            <div class="flex justify-between items-start">
              <h3 class="font-serif text-lg font-bold text-[#3b2314]">Éclair Grand Cru Chocolat</h3>
              <span class="font-bold text-sm text-[#8c5936] ml-2">3,40 €</span>
            </div>
            <p class="text-xs text-[#735b49] mt-1 leading-relaxed">Pâte à choux fraîche, crème pâtissière chocolat Guanaja et glaçage brillant.</p>
          </div>
          <button onclick="addToCart('Éclair Chocolat', 3.40)" class="w-full py-2.5 rounded-xl bg-[#faf4ec] hover:bg-[#8c5936] text-[#594232] hover:text-white font-bold text-xs border border-[#decbb7] transition flex items-center justify-center space-x-2">
            <i class="fa-solid fa-plus text-[10px]"></i>
            <span>Ajouter au panier</span>
          </button>
        </div>
      </div>

      <!-- Item 6 -->
      <div class="product-card bg-white border border-[#e8dfd3] rounded-2xl overflow-hidden shadow-sm hover:shadow-md transition flex flex-col" data-category="patisserie">
        <div class="h-48 overflow-hidden bg-[#e8dfd3] relative">
          <img src="https://images.unsplash.com/photo-1509440159596-0249088772ff?auto=format&fit=crop&w=600&q=80" alt="Tartelette Fruits" class="w-full h-full object-cover">
        </div>
        <div class="p-5 flex-1 flex flex-col justify-between space-y-4">
          <div>
            <div class="flex justify-between items-start">
              <h3 class="font-serif text-lg font-bold text-[#3b2314]">Tartelette aux Fraises de Saison</h3>
              <span class="font-bold text-sm text-[#8c5936] ml-2">4,20 €</span>
            </div>
            <p class="text-xs text-[#735b49] mt-1 leading-relaxed">Fond sablé croustillant, crème d'amande légère et fraises fraîches locales.</p>
          </div>
          <button onclick="addToCart('Tartelette Fraises', 4.20)" class="w-full py-2.5 rounded-xl bg-[#faf4ec] hover:bg-[#8c5936] text-[#594232] hover:text-white font-bold text-xs border border-[#decbb7] transition flex items-center justify-center space-x-2">
            <i class="fa-solid fa-plus text-[10px]"></i>
            <span>Ajouter au panier</span>
          </button>
        </div>
      </div>
    </div>
  </section>

  <!-- Horaires & Accès -->
  <section id="horaires" class="bg-[#f0e6da] border-t border-[#e2d5c4] py-12">
    <div class="max-w-6xl mx-auto px-4 sm:px-6">
      <div class="grid grid-cols-1 md:grid-cols-3 gap-8 text-center md:text-left">
        <div class="space-y-2">
          <h4 class="font-serif font-bold text-lg text-[#3b2314]">Horaires d'Ouverture</h4>
          <p class="text-xs text-[#6e5543] leading-relaxed">Du Mardi au Samedi : 06h30 - 19h30<br>Dimanche matin : 07h00 - 13h00<br><span class="text-[#8c5936] font-semibold">Fermeture hebdomadaire le Lundi</span></p>
        </div>
        <div class="space-y-2">
          <h4 class="font-serif font-bold text-lg text-[#3b2314]">Adresse & Fournil</h4>
          <p class="text-xs text-[#6e5543] leading-relaxed">14 Rue du Moulin des Prés<br>75013 Paris<br>Tél : 01 42 68 90 12</p>
        </div>
        <div class="space-y-2">
          <h4 class="font-serif font-bold text-lg text-[#3b2314]">Engagements Artisan</h4>
          <p class="text-xs text-[#6e5543] leading-relaxed">100% fait maison chaque nuit.<br>Farines locales d'Île-de-France.<br>Zéro produit surgelé ou additif.</p>
        </div>
      </div>
    </div>
  </section>

  <!-- Footer -->
  <footer class="bg-[#382315] text-[#d6c4b2] py-8 border-t border-[#4d3220]">
    <div class="max-w-6xl mx-auto px-4 sm:px-6 flex flex-col sm:flex-row items-center justify-between gap-4 text-xs">
      <div>© 2026 Maison Dupré. Tous droits réservés. Artisans Boulangers.</div>
      <div class="flex space-x-6 text-[#ebd8c5]">
        <a href="#" class="hover:underline">Mentions Légales</a>
        <a href="#" class="hover:underline">Allergènes</a>
        <a href="#" class="hover:underline">Contact</a>
      </div>
    </div>
  </footer>

  <script>
    let cart = [];
    function addToCart(title, price) {
      cart.push({ title, price });
      document.getElementById('cartCount').textContent = cart.length;
      const btn = event.currentTarget;
      const oldHtml = btn.innerHTML;
      btn.innerHTML = '<i class="fa-solid fa-check text-emerald-600"></i><span class="text-emerald-700 font-bold">Ajouté !</span>';
      setTimeout(() => { btn.innerHTML = oldHtml; }, 1200);
    }

    function filterCategory(cat) {
      document.querySelectorAll('.cat-btn').forEach(b => {
        b.className = 'cat-btn px-4 py-2 rounded-xl text-xs font-bold transition bg-white border border-[#d6c7b6] text-[#594232] hover:bg-[#f0e7dc]';
      });
      const activeBtn = document.getElementById('btn-' + cat);
      if (activeBtn) {
        activeBtn.className = 'cat-btn px-4 py-2 rounded-xl text-xs font-bold transition bg-[#8c5936] text-white';
      }

      document.querySelectorAll('.product-card').forEach(card => {
        if (cat === 'all' || card.getAttribute('data-category') === cat) {
          card.style.display = 'flex';
        } else {
          card.style.display = 'none';
        }
      });
    }

    function openCartModal() {
      if (cart.length === 0) {
        alert("Votre panier est actuellement vide. Choisissez de délicieux pains ou viennoiseries !");
      } else {
        const total = cart.reduce((sum, i) => sum + i.price, 0).toFixed(2);
        alert("Panier (" + cart.length + " articles) - Total : " + total + " €\\nRetrait disponible en boutique sous 20 minutes.");
      }
    }
  <\\/script>
</body>
</html>\`;
    }
`;

// Insert generateBakeryApp before synthesizeAppFromPlan if not already present
if (!content.includes('function generateBakeryApp()')) {
  content = content.replace(
    'function synthesizeAppFromPlan(plan, promptText) {',
    bakeryAppFunction + '\n    function synthesizeAppFromPlan(plan, promptText) {'
  );
}

// 2. Update synthesizeAppFromPlan to handle bakery
const oldSynthesize = `    function synthesizeAppFromPlan(plan, promptText) {
      // Construction d'une application complète autonome guidée par le plan
      return (typeof generateInstantApp === 'function')
        ? generateInstantApp(promptText || plan?.title || 'application')
        : (currentAppHtml || '');
    }`;

const newSynthesize = `    function synthesizeAppFromPlan(plan, promptText) {
      const targetText = ((promptText || '') + ' ' + (plan?.title || '') + ' ' + (plan?.goal || '')).toLowerCase();
      if (targetText.includes('boulangerie') || targetText.includes('bakery')) {
        return generateBakeryApp();
      }
      return (typeof generateInstantApp === 'function')
        ? generateInstantApp(promptText || plan?.title || 'application')
        : (currentAppHtml || (typeof generateBakeryApp === 'function' ? generateBakeryApp() : ''));
    }`;

content = content.replace(oldSynthesize, newSynthesize);

// 3. Update renderVolacoPlanCard to render compact badges and monospace file paths
const targetPlanCardStart = 'function renderVolacoPlanCard(plan, intent, conversationId) {';
const oldStepsMapping = `      const steps = plan.steps || [];
      const stepsHtml = steps.map((s, idx) => {
        const stepNum = s.order || (idx + 1);
        const opBadge = s.operation || s.type || '';
        return \`
        <div class="flex items-start space-x-2.5 p-2.5 rounded-xl bg-[#080b18] border border-[#161d36] hover:border-[#222d52] transition">
          <div class="w-5 h-5 rounded-full bg-amber-500/20 text-amber-400 border border-amber-500/40 text-[10px] font-mono font-bold flex items-center justify-center shrink-0 mt-0.5 shadow-sm">
            \${stepNum}
          </div>
          <div class="flex-1 min-w-0">
            <div class="flex items-center justify-between gap-1">
              <span class="text-[11px] font-semibold text-slate-200 truncate">\${escapeStudioHtml(s.title || ('Étape ' + stepNum))}</span>
              \${opBadge ? \`<span class="text-[9px] font-mono px-1.5 py-0.5 rounded bg-slate-800 text-slate-300 border border-slate-700/60 shrink-0 font-medium">\${escapeStudioHtml(opBadge)}</span>\` : ''}
            </div>
            \${s.description ? \`<div class="text-[10px] text-slate-400 leading-relaxed mt-1">\${escapeStudioHtml(s.description)}</div>\` : ''}
          </div>
        </div>
      \`;
      }).join('');`;

const newStepsMapping = `      const steps = plan.steps || [];
      const stepsHtml = steps.map((s, idx) => {
        const stepNum = s.id || s.order || (idx + 1);
        const actionRaw = (s.action || s.operation || s.type || 'create').toLowerCase();
        const action = ['install', 'create', 'edit', 'verify'].includes(actionRaw)
          ? actionRaw
          : (actionRaw === 'modify' ? 'edit' : actionRaw === 'delete' ? 'edit' : actionRaw === 'analyze' ? 'create' : 'create');

        const badgeColor =
          action === 'install' ? 'bg-blue-950/70 border-blue-500/50 text-blue-300' :
          action === 'create' ? 'bg-emerald-950/70 border-emerald-500/50 text-emerald-300' :
          action === 'edit' ? 'bg-amber-950/70 border-amber-500/50 text-amber-300' :
          'bg-purple-950/70 border-purple-500/50 text-purple-300';

        const targetFile = s.target_file || (s.targetFiles && s.targetFiles[0]) || s.title || '';
        const symbols = Array.isArray(s.symbols) ? s.symbols : [];
        const summary = s.summary || s.description || s.title || '';

        return \`
        <div class="p-2.5 rounded-xl bg-[#080b18] border border-[#161d36] hover:border-[#222d52] transition space-y-1.5">
          <div class="flex items-center justify-between gap-1.5">
            <div class="flex items-center space-x-1.5 min-w-0 truncate">
              <span class="text-[9px] font-mono px-1.5 py-0.5 rounded border uppercase font-bold shrink-0 \${badgeColor}">
                [\${escapeStudioHtml(action)}]
              </span>
              <span class="text-[11px] font-mono text-cyan-300 font-medium truncate">
                \${escapeStudioHtml(targetFile)}
              </span>
            </div>
            <span class="text-[9px] font-mono text-slate-500 shrink-0">#\${escapeStudioHtml(String(stepNum))}</span>
          </div>
          \${symbols.length > 0 ? \`
          <div class="flex flex-wrap gap-1">
            \${symbols.map(sym => \`<span class="px-1.5 py-0.2 rounded bg-emerald-950/40 border border-emerald-500/20 text-emerald-300 text-[9px] font-mono">\${escapeStudioHtml(sym)}</span>\`).join('')}
          </div>\` : ''}
          \${summary ? \`<div class="text-[10px] text-slate-300 leading-relaxed font-normal">\${escapeStudioHtml(summary)}</div>\` : ''}
        </div>
      \`;
      }).join('');`;

content = content.replace(oldStepsMapping, newStepsMapping);

// Add stack dependencies display in Plan Card if available
const oldPlanCardHeader = `          <!-- Titre et résumé d'impact -->
          <div class="space-y-1">
            <div class="font-bold text-white text-[13px] leading-snug">\${escapeStudioHtml(plan.title || 'Plan de conception')}</div>
            <p class="text-slate-300 text-[11px] leading-relaxed">\${escapeStudioHtml(plan.summary || plan.goal || '')}</p>
          </div>`;

const newPlanCardHeader = `          <!-- Titre et résumé d'impact -->
          <div class="space-y-1.5">
            <div class="font-bold text-white text-[13px] leading-snug">\${escapeStudioHtml(plan.title || 'Plan de conception')}</div>
            <p class="text-slate-300 text-[11px] leading-relaxed">\${escapeStudioHtml(plan.summary || plan.goal || '')}</p>
            \${(Array.isArray(plan.stack) && plan.stack.length > 0) ? \`
            <div class="flex flex-wrap gap-1 pt-1">
              \${plan.stack.map(st => \`<span class="text-[9px] font-mono px-1.5 py-0.5 rounded bg-[#131b33] border border-[#212c52] text-slate-300">\${escapeStudioHtml(st)}</span>\`).join('')}
            </div>\` : ''}
          </div>`;

content = content.replace(oldPlanCardHeader, newPlanCardHeader);

// 4. Update handleWorkspacePromptSubmit: Auto-execute fresh projects
const oldSubmitFlow = `            // Préservation intelligente de l'Aperçu (ne casse jamais l'application existante)
            if (currentAppHtml && currentAppHtml.length > 200) {
              renderWorkspaceIframe(currentAppHtml);
            } else {
              setWorkspaceSubTab('preview');
              renderWorkspaceIframe(createPlanFirstGateScreen(plan, text));
            }`;

const newSubmitFlow = `            const isFreshProject = !currentAppHtml || currentAppHtml.length <= 200;

            if (isFreshProject) {
              setCompassState("EXECUTING", "EXECUTING", "bg-amber-400", "Génération automatique...");
            } else {
              setCompassState("WAITING_CONFIRMATION", "WAITING_CONFIRMATION", "bg-amber-400", "Confirmation requise");
            }

            // Préservation intelligente de l'Aperçu (ne casse jamais l'application existante)
            if (!isFreshProject) {
              renderWorkspaceIframe(currentAppHtml);
            } else {
              setWorkspaceSubTab('preview');
              renderWorkspaceIframe(createPlanFirstGateScreen(plan, text));
              // Si le projet démarre à zéro (création complète), passer automatiquement à l'exécution sans bloquer indéfiniment sur WAITING_CONFIRMATION
              const planIdToExec = plan.planId || plan.id || ('plan-' + Date.now());
              setTimeout(() => {
                confirmAndExecuteVolacoPlan(planIdToExec);
              }, 400);
            }`;

content = content.replace(oldSubmitFlow, newSubmitFlow);

fs.writeFileSync(filePath, content, 'utf8');
console.log('Successfully updated apps/studio/index.html');

// Synchronize mirrors
const targets = [
  path.join(process.cwd(), 'apps', 'studio', 'volaco_studio.html'),
  path.join(process.cwd(), 'volaco_studio.html'),
  'C:/Users/FAYCAL/.gemini/antigravity/brain/8fa9edf0-0fd9-4b9a-aba5-b16114e16dd7/volaco_studio.html'
];

for (const t of targets) {
  if (fs.existsSync(path.dirname(t))) {
    fs.writeFileSync(t, content, 'utf8');
    console.log('Synchronized:', t);
  }
}
