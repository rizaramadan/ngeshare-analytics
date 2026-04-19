// Region definitions for location-based filtering.
// Keys are stable region IDs; values list lowercased tokens matched via LOWER(up.city)
// and LOWER(up.province). City list is the strict filter for JABODETABEK_TANGSEL;
// provinces stays for future regions that are province-wide (e.g. Pulau Jawa).

export const REGIONS = {
  JABODETABEK_TANGSEL: {
    id: 'JABODETABEK_TANGSEL',
    label: 'Jabodetabek + Tangsel',
    provinces: ['dki jakarta', 'jawa barat', 'banten'],
    cities: [
      'jakarta', 'jakarta pusat', 'jakarta selatan', 'jakarta barat',
      'jakarta timur', 'jakarta utara', 'kepulauan seribu',
      'kota adm. jakarta pusat', 'kota adm. jakarta selatan',
      'kota adm. jakarta barat', 'kota adm. jakarta timur',
      'kota adm. jakarta utara',
      'bogor', 'kabupaten bogor', 'kota bogor', 'kab. bogor',
      'depok', 'kota depok',
      'tangerang', 'kota tangerang', 'kabupaten tangerang', 'kab. tangerang',
      'tangerang selatan', 'kota tangerang selatan',
      'bekasi', 'kota bekasi', 'kabupaten bekasi', 'kab. bekasi',
      'bekasi barat'
    ]
  }
};

export function getRegion(id) {
  return REGIONS[id] || null;
}

export function listRegions() {
  return Object.values(REGIONS).map(r => ({ id: r.id, label: r.label }));
}
