/**
 * The nearest big town to a point, worked out in the browser.
 *
 * "Use my location" in Refine needs to turn a latitude and longitude into
 * something a person recognises ("Fayetteville, AR") without asking a service
 * where they are. So the coordinates never leave the device: this small table
 * is bundled and the nearest row wins. Only the town name is saved, and the
 * person can edit it.
 *
 * Approximate on purpose (to ~0.05°). It names the closest town in the list,
 * not the one you are standing in, and the label in the UI says so.
 */

type Town = [name: string, lat: number, lon: number]

const TOWNS: Town[] = [
  ['Birmingham, AL', 33.52, -86.8], ['Huntsville, AL', 34.73, -86.59], ['Mobile, AL', 30.69, -88.04],
  ['Montgomery, AL', 32.38, -86.3], ['Anchorage, AK', 61.22, -149.9], ['Phoenix, AZ', 33.45, -112.07],
  ['Tucson, AZ', 32.22, -110.97], ['Flagstaff, AZ', 35.2, -111.65], ['Fayetteville, AR', 36.06, -94.16],
  ['Fort Smith, AR', 35.39, -94.4], ['Jonesboro, AR', 35.84, -90.7], ['Little Rock, AR', 34.75, -92.29],
  ['Texarkana, AR', 33.43, -94.05], ['Los Angeles, CA', 34.05, -118.24], ['San Diego, CA', 32.72, -117.16],
  ['San Francisco, CA', 37.77, -122.42], ['San Jose, CA', 37.34, -121.89], ['Sacramento, CA', 38.58, -121.49],
  ['Fresno, CA', 36.74, -119.79], ['Bakersfield, CA', 35.37, -119.02], ['Redding, CA', 40.59, -122.39],
  ['Denver, CO', 39.74, -104.99], ['Colorado Springs, CO', 38.83, -104.82], ['Grand Junction, CO', 39.06, -108.55],
  ['Hartford, CT', 41.76, -72.69], ['New Haven, CT', 41.31, -72.92], ['Wilmington, DE', 39.74, -75.55],
  ['Washington, DC', 38.91, -77.04], ['Miami, FL', 25.76, -80.19], ['Orlando, FL', 28.54, -81.38],
  ['Tampa, FL', 27.95, -82.46], ['Jacksonville, FL', 30.33, -81.66], ['Tallahassee, FL', 30.44, -84.28],
  ['Pensacola, FL', 30.42, -87.22], ['Atlanta, GA', 33.75, -84.39], ['Savannah, GA', 32.08, -81.09],
  ['Macon, GA', 32.84, -83.63], ['Honolulu, HI', 21.31, -157.86], ['Boise, ID', 43.62, -116.2],
  ['Idaho Falls, ID', 43.49, -112.04], ['Chicago, IL', 41.88, -87.63], ['Springfield, IL', 39.8, -89.65],
  ['Peoria, IL', 40.69, -89.59], ['Indianapolis, IN', 39.77, -86.16], ['Fort Wayne, IN', 41.08, -85.14],
  ['Evansville, IN', 37.97, -87.57], ['Des Moines, IA', 41.59, -93.62], ['Cedar Rapids, IA', 41.98, -91.67],
  ['Sioux City, IA', 42.5, -96.4], ['Kansas City, KS', 39.11, -94.63], ['Wichita, KS', 37.69, -97.34],
  ['Topeka, KS', 39.05, -95.68], ['Louisville, KY', 38.25, -85.76], ['Lexington, KY', 38.04, -84.5],
  ['New Orleans, LA', 29.95, -90.07], ['Baton Rouge, LA', 30.45, -91.19], ['Shreveport, LA', 32.53, -93.75],
  ['Portland, ME', 43.66, -70.26], ['Bangor, ME', 44.8, -68.78], ['Baltimore, MD', 39.29, -76.61],
  ['Boston, MA', 42.36, -71.06], ['Springfield, MA', 42.1, -72.59], ['Detroit, MI', 42.33, -83.05],
  ['Grand Rapids, MI', 42.96, -85.67], ['Marquette, MI', 46.54, -87.4], ['Minneapolis, MN', 44.98, -93.27],
  ['Duluth, MN', 46.79, -92.1], ['Rochester, MN', 44.02, -92.47], ['Jackson, MS', 32.3, -90.18],
  ['Gulfport, MS', 30.37, -89.09], ['Tupelo, MS', 34.26, -88.7], ['St. Louis, MO', 38.63, -90.2],
  ['Kansas City, MO', 39.1, -94.58], ['Springfield, MO', 37.21, -93.29], ['Joplin, MO', 37.08, -94.51],
  ['Billings, MT', 45.78, -108.5], ['Missoula, MT', 46.87, -113.99], ['Omaha, NE', 41.26, -95.93],
  ['Lincoln, NE', 40.81, -96.7], ['Las Vegas, NV', 36.17, -115.14], ['Reno, NV', 39.53, -119.81],
  ['Manchester, NH', 42.99, -71.46], ['Newark, NJ', 40.74, -74.17], ['Trenton, NJ', 40.22, -74.76],
  ['Albuquerque, NM', 35.08, -106.65], ['Santa Fe, NM', 35.69, -105.94], ['Las Cruces, NM', 32.32, -106.76],
  ['New York, NY', 40.71, -74.01], ['Buffalo, NY', 42.89, -78.88], ['Albany, NY', 42.65, -73.76],
  ['Rochester, NY', 43.16, -77.61], ['Charlotte, NC', 35.23, -80.84], ['Raleigh, NC', 35.78, -78.64],
  ['Asheville, NC', 35.6, -82.55], ['Wilmington, NC', 34.23, -77.94], ['Fargo, ND', 46.88, -96.79],
  ['Bismarck, ND', 46.81, -100.78], ['Columbus, OH', 39.96, -83.0], ['Cleveland, OH', 41.5, -81.69],
  ['Cincinnati, OH', 39.1, -84.51], ['Toledo, OH', 41.65, -83.54], ['Oklahoma City, OK', 35.47, -97.52],
  ['Tulsa, OK', 36.15, -95.99], ['Portland, OR', 45.52, -122.68], ['Eugene, OR', 44.05, -123.09],
  ['Bend, OR', 44.06, -121.31], ['Philadelphia, PA', 39.95, -75.17], ['Pittsburgh, PA', 40.44, -79.99],
  ['Harrisburg, PA', 40.27, -76.88], ['Providence, RI', 41.82, -71.41], ['Charleston, SC', 32.78, -79.93],
  ['Columbia, SC', 34.0, -81.03], ['Greenville, SC', 34.85, -82.4], ['Sioux Falls, SD', 43.55, -96.73],
  ['Rapid City, SD', 44.08, -103.23], ['Nashville, TN', 36.16, -86.78], ['Memphis, TN', 35.15, -90.05],
  ['Knoxville, TN', 35.96, -83.92], ['Chattanooga, TN', 35.05, -85.31], ['Houston, TX', 29.76, -95.37],
  ['Dallas, TX', 32.78, -96.8], ['Austin, TX', 30.27, -97.74], ['San Antonio, TX', 29.42, -98.49],
  ['El Paso, TX', 31.76, -106.49], ['Lubbock, TX', 33.58, -101.86], ['Amarillo, TX', 35.22, -101.83],
  ['Corpus Christi, TX', 27.8, -97.4], ['Salt Lake City, UT', 40.76, -111.89], ['St. George, UT', 37.1, -113.58],
  ['Burlington, VT', 44.48, -73.21], ['Richmond, VA', 37.54, -77.44], ['Norfolk, VA', 36.85, -76.29],
  ['Roanoke, VA', 37.27, -79.94], ['Seattle, WA', 47.61, -122.33], ['Spokane, WA', 47.66, -117.43],
  ['Charleston, WV', 38.35, -81.63], ['Milwaukee, WI', 43.04, -87.91], ['Madison, WI', 43.07, -89.4],
  ['Green Bay, WI', 44.52, -88.02], ['Cheyenne, WY', 41.14, -104.82], ['Casper, WY', 42.87, -106.31],
]

/** Great-circle distance in km (haversine). */
function km(lat1: number, lon1: number, lat2: number, lon2: number): number {
  const rad = Math.PI / 180
  const dLat = (lat2 - lat1) * rad
  const dLon = (lon2 - lon1) * rad
  const a =
    Math.sin(dLat / 2) ** 2 + Math.cos(lat1 * rad) * Math.cos(lat2 * rad) * Math.sin(dLon / 2) ** 2
  return 6371 * 2 * Math.asin(Math.sqrt(a))
}

/** The closest town in the list to a point, as "City, ST". */
export function nearestTown(lat: number, lon: number): string {
  let best = TOWNS[0]
  let bestKm = Infinity
  for (const t of TOWNS) {
    const d = km(lat, lon, t[1], t[2])
    if (d < bestKm) {
      best = t
      bestKm = d
    }
  }
  return best[0]
}
