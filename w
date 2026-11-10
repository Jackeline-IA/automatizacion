warning: in the working copy of 'next.config.ts', LF will be replaced by CRLF the next time Git touches it
[1mdiff --git a/next.config.ts b/next.config.ts[m
[1mindex 23d1f5e..4a698f6 100644[m
[1m--- a/next.config.ts[m
[1m+++ b/next.config.ts[m
[36m@@ -3,7 +3,9 @@[m [mimport type { NextConfig } from "next";[m
 const nextConfig: NextConfig = {[m
   /* config options here */[m
   experimental: {[m
[31m-    agentFeedback: true,[m
[32m+[m[32m    // Desactivado: con `true`, `next dev` añade un bloque a AGENTS.md en cada[m
[32m+[m[32m    // arranque y lo restaura si se borra (el archivo quedaba siempre modificado).[m
[32m+[m[32m    agentFeedback: false,[m
   },[m
   cacheComponents: true,[m
   partialPrefetching: true,[m
