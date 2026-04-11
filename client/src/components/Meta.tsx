import { Helmet } from 'react-helmet-async';

interface MetaProps {
  title?: string;
  description?: string;
  image?: string;
  url?: string;
}

export default function Meta({ 
  title = "ConvoSpan Intel — Sovereign Alpha Layer", 
  description = "Real-time procurement signal intelligence across India & UAE government registries. Intercept buyer intent before it hits the open market.",
  image = "/og-image.png",
  url = "https://convospan.intel"
}: MetaProps) {
  const fullTitle = `${title} | Registry Intelligence Protocol`;

  return (
    <Helmet>
      {/* Primary Meta Tags */}
      <title>{fullTitle}</title>
      <meta name="title" content={fullTitle} />
      <meta name="description" content={description} />

      {/* Open Graph / Facebook */}
      <meta property="og:type" content="website" />
      <meta property="og:url" content={url} />
      <meta property="og:title" content={fullTitle} />
      <meta property="og:description" content={description} />
      <meta property="og:image" content={image} />

      {/* Twitter */}
      <meta property="twitter:card" content="summary_large_image" />
      <meta property="twitter:url" content={url} />
      <meta property="twitter:title" content={fullTitle} />
      <meta property="twitter:description" content={description} />
      <meta property="twitter:image" content={image} />
      
      {/* Production Hardening */}
      <meta name="viewport" content="width=device-width, initial-scale=1, maximum-scale=1, user-scalable=0" />
      <meta name="theme-color" content="#020813" />
    </Helmet>
  );
}
 bitumen: 121
