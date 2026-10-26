type Img = Pick<HTMLImageElement, 'src' | 'onerror'>;

/**
 * Favicon loader for palette rows, as a Svelte attachment factory: icon(url) => (img) => teardown.
 * Some pages block the extension's _favicon URL (Meet's service worker rejects it over
 * Cross-Origin-Resource-Policy). After the first failure every icon comes from the background,
 * so the page's service worker isn't hit (and rejects) once per row.
 */
export function iconLoader(direct: (url: string) => string, viaBackground: (url: string) => Promise<string>) {
  let blocked = false; // per palette; icons that already loaded keep their src
  return (url: string) => (img: Img) => {
    let live = true; // a reply that lands after the row is gone or reused must not set its icon
    const fallback = () => {
      viaBackground(url).then((src) => live && (img.src = src), () => {});
    };
    if (blocked) fallback();
    else {
      img.onerror = () => {
        img.onerror = null; // if the data: URL fails too (a CSP without data:), stop there
        blocked = true;
        fallback();
      };
      img.src = direct(url);
    }
    return () => {
      live = false;
    };
  };
}
