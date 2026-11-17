interface BrandMarkProps {
    className?: string;
    /** "wordmark" is the full horizontal logo; "icon" is the mark alone. */
    variant?: 'icon' | 'wordmark';
    /** Use the light-background artwork. */
    onLight?: boolean;
}

export default function BrandMark({ className = 'w-7 h-7', variant = 'icon', onLight = false }: BrandMarkProps) {
    const src = variant === 'icon' ? '/netjana-icon.svg' : onLight ? '/netjana-logo-light.svg' : '/netjana-logo.svg';
    return <img src={src} alt="NetJana" className={className} />;
}
