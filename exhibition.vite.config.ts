import{defineConfig}from'vite';import react from'@vitejs/plugin-react';import{resolve}from'node:path';
// Local-only new-hand exhibition. Old website and sample candidate builds stay intact.
export default defineConfig({plugins:[react()],publicDir:'public',server:{host:'127.0.0.1',port:3528,strictPort:true,watch:{ignored:['**/._*']}},build:{outDir:'exhibition-dist',copyPublicDir:false,rollupOptions:{input:{exhibition:resolve('exhibition/index.html')}},commonjsOptions:{include:[/vendor\/cubejs/,/node_modules/]}},optimizeDeps:{include:['cubejs']}});
