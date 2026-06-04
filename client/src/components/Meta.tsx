import { Helmet } from 'react-helmet-async';

interface MetaProps {
  title?: string;
  description?: string;
  image?: string;
  url?: string;
}

export default function Meta({
  title = "NetJana AI - Buyer Signal OS",
  description = "NetJana AI captures buyer-intent signals, scores demand with autonomous agents, and routes verified accounts into outbound systems like CraftMyFunnel.",
  image = "/og-image.png",
  url = "https://netjana.ai"
}: MetaProps) {
  const fullTitle = `${title} | Registry Intelligence Protocol`;

  return (
    <Helmet>
      <title>{fullTitle}</title>
      <meta name="title" content={fullTitle} />
      <meta name="description" content={description} />

      <meta property="og:type" content="website" />
      <meta property="og:url" content={url} />
      <meta property="og:title" content={fullTitle} />
      <meta property="og:description" content={description} />
      <meta property="og:image" content={image} />

      <meta property="twitter:card" content="summary_large_image" />
      <meta property="twitter:url" content={url} />
      <meta property="twitter:title" content={fullTitle} />
      <meta property="twitter:description" content={description} />
      <meta property="twitter:image" content={image} />

      <meta name="viewport" content="width=device-width, initial-scale=1, maximum-scale=1, user-scalable=0" />
      <meta name="theme-color" content="#020813" />
    </Helmet>
  );
}
