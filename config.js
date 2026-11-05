// Runtime configuration of the web app.
//
// apiBase: leave empty when this web app is served by the PosChanger server itself
// (Docker setup). When the web app is hosted on GitHub Pages, set it to the public
// HTTPS address of your server, e.g. 'https://poschanger.example.com'.
// The GitHub Pages workflow writes this value for you from the API_BASE_URL variable.
window.APP_CONFIG = {
  apiBase: 'https://poschanger.solarswap.io',

  // Map tiles. Default: Esri "Dark Gray Canvas" (no API key needed, attribution required).
  // Alternatives (need a free account / key):
  //   CARTO Dark Matter: 'https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png?api_key=YOUR_KEY'
  //   Stadia Alidade Smooth Dark: 'https://tiles.stadiamaps.com/tiles/alidade_smooth_dark/{z}/{x}/{y}{r}.png'
  tiles: [
    {
      url: 'https://server.arcgisonline.com/ArcGIS/rest/services/Canvas/World_Dark_Gray_Base/MapServer/tile/{z}/{y}/{x}',
      maxNativeZoom: 16,
      filter: 'brightness(0.6) contrast(1.2)',
    },
    {
      url: 'https://server.arcgisonline.com/ArcGIS/rest/services/Canvas/World_Dark_Gray_Reference/MapServer/tile/{z}/{y}/{x}',
      maxNativeZoom: 16,
    },
  ],
  tileAttribution: 'Tiles &copy; Esri &mdash; Esri, HERE, Garmin, &copy; OpenStreetMap contributors',
  maxZoom: 19,
};
