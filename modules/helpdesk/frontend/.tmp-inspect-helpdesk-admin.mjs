const mod = await import('./app/admin/page.tsx');
console.log('keys', Object.keys(mod));
console.log('default type', typeof mod.default, mod.default && mod.default.constructor && mod.default.constructor.name);
console.log('default keys', mod.default && typeof mod.default === 'object' ? Object.keys(mod.default) : []);
console.log('nested default type', typeof mod.default?.default);
