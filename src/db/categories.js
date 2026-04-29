const TAXONOMY = [
  { slug: 'tecnologia',                       name: 'Tecnologia',              parent_slug: null,          display_order: 1 },
  { slug: 'tecnologia/smartphone',            name: 'Smartphone',              parent_slug: 'tecnologia',  display_order: 1 },
  { slug: 'tecnologia/tablet',                name: 'Tablet',                  parent_slug: 'tecnologia',  display_order: 2 },
  { slug: 'tecnologia/pc-laptop',             name: 'PC & Laptop',             parent_slug: 'tecnologia',  display_order: 3 },
  { slug: 'tecnologia/audio',                 name: 'Audio',                   parent_slug: 'tecnologia',  display_order: 4 },
  { slug: 'tecnologia/tv-monitor',            name: 'TV & Monitor',            parent_slug: 'tecnologia',  display_order: 5 },
  { slug: 'tecnologia/fotografia',            name: 'Fotografia',              parent_slug: 'tecnologia',  display_order: 6 },
  { slug: 'tecnologia/gaming',                name: 'Gaming',                  parent_slug: 'tecnologia',  display_order: 7 },
  { slug: 'tecnologia/accessori',             name: 'Accessori Tech',          parent_slug: 'tecnologia',  display_order: 8 },
  { slug: 'tecnologia/smart-home',            name: 'Smart Home',              parent_slug: 'tecnologia',  display_order: 9 },

  { slug: 'casa',                             name: 'Casa & Cucina',           parent_slug: null,          display_order: 2 },
  { slug: 'casa/elettrodomestici-grandi',     name: 'Grandi Elettrodomestici', parent_slug: 'casa',        display_order: 1 },
  { slug: 'casa/elettrodomestici-piccoli',    name: 'Piccoli Elettrodomestici',parent_slug: 'casa',        display_order: 2 },
  { slug: 'casa/arredamento',                 name: 'Arredamento',             parent_slug: 'casa',        display_order: 3 },
  { slug: 'casa/pulizia',                     name: 'Pulizia',                 parent_slug: 'casa',        display_order: 4 },

  { slug: 'moda',                             name: 'Moda & Sport',            parent_slug: null,          display_order: 3 },
  { slug: 'moda/abbigliamento',               name: 'Abbigliamento',           parent_slug: 'moda',        display_order: 1 },
  { slug: 'moda/scarpe',                      name: 'Scarpe',                  parent_slug: 'moda',        display_order: 2 },
  { slug: 'moda/sport',                       name: 'Sport & Outdoor',         parent_slug: 'moda',        display_order: 3 },
  { slug: 'moda/borse',                       name: 'Borse & Accessori',       parent_slug: 'moda',        display_order: 4 },

  { slug: 'alimentari',                       name: 'Alimentari',              parent_slug: null,          display_order: 4 },
  { slug: 'alimentari/cibo',                  name: 'Cibo & Bevande',          parent_slug: 'alimentari',  display_order: 1 },
  { slug: 'alimentari/integratori',           name: 'Integratori',             parent_slug: 'alimentari',  display_order: 2 },

  { slug: 'media',                            name: 'Libri & Media',           parent_slug: null,          display_order: 5 },
  { slug: 'media/libri',                      name: 'Libri',                   parent_slug: 'media',       display_order: 1 },
  { slug: 'media/film-serie',                 name: 'Film & Serie',            parent_slug: 'media',       display_order: 2 },
  { slug: 'media/musica',                     name: 'Musica',                  parent_slug: 'media',       display_order: 3 },

  { slug: 'servizi',                          name: 'Servizi & Abbonamenti',   parent_slug: null,          display_order: 6 },
  { slug: 'servizi/streaming',                name: 'Streaming',               parent_slug: 'servizi',     display_order: 1 },
  { slug: 'servizi/software',                 name: 'Software',                parent_slug: 'servizi',     display_order: 2 },
  { slug: 'servizi/cloud',                    name: 'Cloud',                   parent_slug: 'servizi',     display_order: 3 },

  { slug: 'altro',                            name: 'Altro',                   parent_slug: null,          display_order: 99 },
];

// Each entry: most-specific slug → array of Italian/English match strings (lowercase)
const ALIASES = {
  'tecnologia/smartphone':         ['smartphone', 'telefono', 'iphone', 'samsung galaxy', 'android phone', 'cellulare', 'mobile phone', 'pixel'],
  'tecnologia/tablet':             ['tablet', 'ipad', 'samsung tab', 'kindle fire', 'fire hd'],
  'tecnologia/pc-laptop':          ['laptop', 'notebook', 'macbook', 'pc portatile', 'computer', 'ultrabook', 'chromebook', 'thinkpad', 'surface pro', 'desktop pc'],
  'tecnologia/audio':              ['cuffie', 'auricolari', 'speaker', 'headphones', 'earbuds', 'airpods', 'soundbar', 'amplificatore', 'dac audio', 'casse bluetooth', 'jbl', 'bose', 'sennheiser', 'beats', 'audio equipment', 'microfono', 'microphone'],
  'tecnologia/tv-monitor':         ['tv', 'televisore', 'monitor', 'oled', 'qled', 'schermo', 'display', 'smart tv', 'projector', 'proiettore'],
  'tecnologia/fotografia':         ['fotocamera', 'camera', 'obiettivo', 'drone', 'gopro', 'action cam', 'reflex', 'mirrorless', 'flash fotografico'],
  'tecnologia/gaming':             ['gaming', 'console', 'playstation', 'xbox', 'nintendo', 'switch', 'ps5', 'ps4', 'videogiochi', 'videogames', 'giochi pc', 'steam deck', 'controller'],
  'tecnologia/accessori':          ['caricabatterie', 'power bank', 'cavo usb', 'hub usb', 'cover', 'custodia', 'mouse', 'tastiera', 'keyboard', 'webcam', 'ssd esterno', 'chiavetta usb', 'accessori', 'memory card', 'memory cards', 'sd card', 'smartwatch', 'apple watch', 'galaxy watch', 'watch', 'fitness band', 'fitness tracker', 'wearable', 'networking', 'router', 'switch di rete', 'access point', 'modem'],
  'tecnologia/smart-home':         ['smart home', 'alexa', 'google home', 'philips hue', 'ring doorbell', 'robot aspirapolvere', 'videocamera sorveglianza', 'lampadina smart', 'zigbee'],
  'tecnologia':                    ['elettronica', 'tech', 'tecnologia', 'electronics', 'hi-fi'],

  'casa/elettrodomestici-grandi':  ['lavatrice', 'lavastoviglie', 'frigorifero', 'forno da incasso', 'piano cottura', 'asciugatrice', 'congelatore'],
  'casa/elettrodomestici-piccoli': ['frullatore', 'macchina caffe', 'tostapane', 'aspirapolvere', 'ferro da stiro', 'air fryer', 'microonde', 'robot cucina', 'friggitrice', 'robot aspirapolvere', 'robot lavapavimenti', 'robot'],
  'casa/arredamento':              ['divano', 'sedia', 'tavolo', 'letto', 'armadio', 'scaffale', 'arredamento', 'ikea', 'libreria'],
  'casa/pulizia':                  ['detersivo', 'pulizia casa', 'scopa', 'mocio', 'prodotto pulizia', 'bucato'],
  'casa':                          ['casa', 'cucina', 'home', 'domestico', 'elettrodomestici', 'elettrodomestico'],

  'moda/abbigliamento':            ['abbigliamento', 'maglietta', 'felpa', 'giacca', 'jeans', 'pantaloni', 'vestiti', 'camicia', 't-shirt'],
  'moda/scarpe':                   ['scarpe', 'sneakers', 'stivali', 'sandali', 'nike', 'adidas', 'new balance', 'calzature', 'mocassini'],
  'moda/sport':                    ['sport', 'fitness', 'palestra', 'bici', 'running', 'trekking', 'sci', 'yoga', 'ciclismo'],
  'moda/borse':                    ['borsa', 'zaino', 'valigia', 'portafoglio', 'accessori moda', 'trolley'],
  'moda':                          ['moda', 'fashion', 'abbigliamento'],

  'alimentari/cibo':               ['cibo', 'bevande', 'supermercato', 'snack', 'pasta', 'caffe', 'vino', 'olio', 'alimentari'],
  'alimentari/integratori':        ['integratori', 'proteine', 'vitamina', 'omega 3', 'myprotein', 'supplement', 'creatina'],
  'alimentari':                    ['food', 'alimentare', 'mangiare'],

  'media/libri':                   ['libro', 'libri', 'kindle', 'ebook', 'audible', 'fumetti', 'romanzo'],
  'media/film-serie':              ['film', 'serie tv', 'dvd', 'blu-ray', 'streaming film'],
  'media/musica':                  ['musica', 'vinile', 'cd musicale', 'concerti'],

  'servizi/streaming':             ['netflix', 'disney+', 'amazon prime', 'spotify', 'streaming', 'abbonamento tv', 'apple tv+'],
  'servizi/software':              ['software', 'antivirus', 'office', 'adobe', 'licenza software', 'app premium'],
  'servizi/cloud':                 ['cloud storage', 'vpn', 'hosting', 'dropbox', 'icloud', 'google one'],

  'altro':                         ['altro', 'misc', 'miscellaneous', 'cosmetici', 'cosmetic', 'beauty', 'profumo', 'auto accessori', 'auto', 'moto', 'toy', 'giocattolo', 'giocattoli', 'insect repellent', 'repellent', 'animali', 'pet', 'cancelleria'],
};

class CategoryMapper {
  constructor() {
    // Pre-sort: children (depth 2) before parents (depth 1) — most specific wins
    this._index = Object.entries(ALIASES)
      .sort((a, b) => b[0].split('/').length - a[0].split('/').length)
      .map(([slug, aliases]) => ({ slug, aliases: aliases.map(a => a.toLowerCase()) }));
  }

  // Returns slug (e.g. 'tecnologia/audio') or null
  map(rawCategory) {
    if (!rawCategory) return null;
    const lower = rawCategory.toLowerCase().trim();
    // Direct slug match — LLM is instructed to return canonical slugs
    if (TAXONOMY.some(t => t.slug === lower)) return lower;
    for (const { slug, aliases } of this._index) {
      if (aliases.some(alias => lower.includes(alias))) return slug;
    }
    return null;
  }

  getName(slug) {
    const cat = TAXONOMY.find(c => c.slug === slug);
    return cat ? cat.name : slug;
  }

  getParent(slug) {
    const cat = TAXONOMY.find(c => c.slug === slug);
    return cat ? cat.parent_slug : null;
  }
}

module.exports = { TAXONOMY, ALIASES, CategoryMapper };
