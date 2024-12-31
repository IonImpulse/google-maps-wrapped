
let globe;

// Initialize the globe when the page loads
function initGlobe() {
    // Create a new Globe instance
    globe = new Globe(document.getElementById('globe-viz'))
        .globeImageUrl('/assets/8081_earthmap10k.jpg')
        .arcsData([])
        .arcColor('color')
        .arcStroke(0.5)
        .arcDashLength(1) // Full length for solid line
        .arcDashGap(0) // No gap
        .arcDashAnimateTime(0) // No animation by default
        .arcsTransitionDuration(300)
        .arcLabel((d) => `${d.type}: ${d.startTime.toLocaleString()}`)
        .arcAltitude(d => {
            if (d.type === 'FLYING') return 0.1 * (Math.random() + 1); // Higher arcs for flights
            else return 0.01; // Lower arcs for other types
        });
    // Adjust camera controls
    globe.controls().enableZoom = true; // Enable zoom to allow altitude changes
}

// Call initGlobe when the page loads
document.addEventListener('DOMContentLoaded', initGlobe);

async function sleep(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
}

function createIconElement(cityName) {
    const el = document.createElement('div');
    el.className = 'city-icon';
    el.innerHTML = `<i class="material-icons">location_city</i><span>${cityName}</span>`;
    el.title = cityName;
    return el;
}

function handleFile(file) {
    // Read the file, which is a JSON file
    const reader = new FileReader();
    reader.readAsText(file);
    reader.onload = async () => {
        const data = JSON.parse(reader.result);
        await dataToIndexedDB(data);
        await findTrips();
        await showTrips();
    }
}

async function showTrips() {
    // Ensure the globe is initialized
    if (!globe) {
        console.error('Globe has not been initialized.');
        return;
    }
    // Get the trips from the db
    const db = await idb.openDB('gmaps-wrapped', 1);
    const transaction = db.transaction('trips', 'readonly');
    const store = transaction.objectStore('trips');
    let trips = await store.getAll();
    console.log('Fetched trips:', trips);
    // Process trips data for globe.gl
    const arcsData = [];
    const typeColors = {
        'FLYING': 'pink',
        'IN_BUS': 'yellow',
        'IN_FERRY': 'blue',
        'IN_PASSENGER_VEHICLE': 'green',
        'IN_SUBWAY': 'purple',
        'IN_TRAIN': 'orange',
        'IN_TRAM': 'cyan',
        'CYCLING': 'lime',
        'MOTORCYCLING': 'red',
        'RUNNING': 'magenta',
        'WALKING': 'white',
        'UNKNOWN_ACTIVITY_TYPE': 'grey'
    };
    // Map trip types to Google Material Icons
    const typeIcons = {
        'FLYING': 'flight',
        'IN_BUS': 'directions_bus',
        'IN_FERRY': 'directions_boat',
        'IN_PASSENGER_VEHICLE': 'drive_eta',
        'IN_SUBWAY': 'subway',
        'IN_TRAIN': 'train',
        'IN_TRAM': 'tram',
        'CYCLING': 'directions_bike',
        'MOTORCYCLING': 'two_wheeler',
        'RUNNING': 'directions_run',
        'WALKING': 'directions_walk',
        'UNKNOWN_ACTIVITY_TYPE': 'help_outline'
    };
    const typeToReadable = {
        'FLYING': 'Airplane',
        'IN_BUS': 'Bus',
        'IN_FERRY': 'Ferry',
        'IN_PASSENGER_VEHICLE': 'Car',
        'IN_SUBWAY': 'Subway',
        'IN_TRAIN': 'Train',
        'IN_TRAM': 'Tram',
        'CYCLING': 'Cycling',
        'MOTORCYCLING': 'Motorcycle',
        'RUNNING': 'Running',
        'WALKING': 'Walking',
        'UNKNOWN_ACTIVITY_TYPE': 'Unknown'
    }
    // Sort trips by startTime
    trips.sort((a, b) => new Date(a.startTime) - new Date(b.startTime));
    // Only include trips from the most recent year
    const currentYear = new Date().getFullYear();
    trips = trips.filter(trip => new Date(trip.startTime).getFullYear() === currentYear);
    for (const trip of trips) {
        // Ensure the trip has activity data with start and end locations
        if (trip.activity && trip.activity.start && trip.activity.end) {
            const startLatLng = trip.activity.start.latLng;
            const endLatLng = trip.activity.end.latLng;
            if (startLatLng && endLatLng) {
                // Split the "LATITUDE, LONGITUDE" string into separate values
                const [startLatStr, startLngStr] = startLatLng.split(',');
                const [endLatStr, endLngStr] = endLatLng.split(',');
                // Parse the strings into floats
                const startLat = parseFloat(startLatStr.trim());
                const startLng = parseFloat(startLngStr.trim());
                const endLat = parseFloat(endLatStr.trim());
                const endLng = parseFloat(endLngStr.trim());
                // Check if any of the coordinates is NaN
                if (!isNaN(startLat) && !isNaN(startLng) && !isNaN(endLat) && !isNaN(endLng)) {
                    const type = trip.activity.topCandidate.type;
                    const color = typeColors[type] || 'grey';
                    arcsData.push({
                        startLat,
                        startLng,
                        endLat,
                        endLng,
                        color,
                        type,
                        startTime: new Date(trip.startTime),
                        endTime: new Date(trip.endTime),
                        startCity: trip.startCity,
                        endCity: trip.endCity,
                    });
                } else {
                    console.warn('Invalid coordinates in trip:', trip);
                }
            } else {
                console.warn('Missing start or end coordinates in trip:', trip);
            }
        } else {
            console.warn('Invalid activity data in trip:', trip);
        }
    }
    if (arcsData.length === 0) {
        console.error('No valid trips found to display.');
        return;
    }
    // Clear existing arcs data
    globe.arcsData([]);
    const visitedCities = new Set();
    const cityIcons = [];

    // Set up the globe to use city icons
    globe.htmlElementsData(cityIcons)
        .htmlLat(d => d.lat)
        .htmlLng(d => d.lng)
        .htmlElement(d => d.element);

    // Setup for animations
    let index = 0;
    // Main animation loop
    async function addNextTrip() {
        if (index < arcsData.length) {
            const currentTrip = arcsData[index];
            // Calculate icon, time, distance, and city names
            const iconName = typeIcons[currentTrip.type] || 'help_outline';
            const typeName = typeToReadable[currentTrip.type] || 'Unknown';
            const totalTimeMS = currentTrip.endTime - currentTrip.startTime;
            const distanceMeters = calculateDistance(
                currentTrip.startLat,
                currentTrip.startLng,
                currentTrip.endLat,
                currentTrip.endLng
            );
            const distanceMiles = distanceMeters * 0.0006213712;

            // Fetch city names using world_cities.json data
            const startCity = currentTrip.startCity;
            const endCity = currentTrip.endCity;

            // Update the trip info div
            updateTripInfo(iconName, typeName, totalTimeMS, distanceMiles, startCity, endCity);

            // Update the camera to focus on the current trip
            const { startLat, startLng, endLat, endLng, type } = currentTrip;
            // Calculate the midpoint between start and end points
            const midLat = calculateMidLat(startLat, endLat);
            const midLng = calculateMidLng(startLng, endLng);
            // Calculate the appropriate altitude to fit the trip
            const altitude = calculateFitAltitude(startLat, startLng, endLat, endLng, type);
            // Calculate transition duration based on angular distance
            const transitionDuration = calculateTransitionDuration(index, arcsData, midLat, midLng);
            // Adjust the camera's point of view smoothly
            globe.pointOfView(
                {
                    lat: midLat,
                    lng: midLng,
                    altitude: altitude,
                },
                transitionDuration,
                TWEEN.Easing.Quadratic.InOut
            );

            // Animate arcs and globe as before
            const animatedArc = {
                ...currentTrip,
                dashLength: 1, // Full length
                dashGap: 0, // No gap
                dashAnimateTime: 0 ,// No animation
            };
            // Add the next trip to the arcs data
            globe.arcsData([...globe.arcsData(), animatedArc]);

            if (!visitedCities.has(currentTrip.startCity)) {
                visitedCities.add(currentTrip.startCity);

                cityIcons.push({
                    city: currentTrip.startCity,
                    lat: currentTrip.startLat,
                    lng: currentTrip.startLng,
                    element: createIconElement(currentTrip.startCity)
                });

                // Update the globe with new city icons
                globe.htmlElementsData([...cityIcons]);
            } 
            
            if (!visitedCities.has(currentTrip.endCity)) {
                visitedCities.add(currentTrip.endCity);

                cityIcons.push({
                    city: currentTrip.endCity,
                    lat: currentTrip.endLat,
                    lng: currentTrip.endLng,
                    element: createIconElement(currentTrip.endCity)
                });

                // Update the globe with new city icons
                globe.htmlElementsData([...cityIcons]);
            }

            index++;
            await sleep(transitionDuration);
            setTimeout(addNextTrip, transitionDuration + 10);
        }
    }
    addNextTrip();
}

// Function to update the trip info div
function updateTripInfo(iconName, type, totalTimeMS, distanceMiles, startCity, endCity) {
    const tripInfoDiv = document.getElementById('trip-info');

    // Format total time
    const totalSeconds = Math.floor(totalTimeMS / 1000);
    const hours = Math.floor(totalSeconds / 3600);
    const minutes = Math.floor((totalSeconds % 3600) / 60);
    const timeString = `${hours}h ${minutes}m`;

    const distanceString = `${distanceMiles.toFixed(1)} miles`;

    tripInfoDiv.innerHTML = `
        <i class="material-icons">${iconName}</i>
        <div class="details">
            <div><strong>${type}</strong></div>
            <div>${timeString}, ${distanceString}</div>
            <div>${startCity} &rarr; ${endCity}</div>
        </div>
    `;
}

// Function to calculate distance between two coordinates in meters
function calculateDistance(lat1, lon1, lat2, lon2) {
    const R = 6371e3; // Earth radius in meters
    const φ1 = (lat1 * Math.PI) / 180;
    const φ2 = (lat2 * Math.PI) / 180;
    const Δφ = ((lat2 - lat1) * Math.PI) / 180;
    const Δλ = ((lon2 - lon1) * Math.PI) / 180;
    const a =
        Math.sin(Δφ / 2) * Math.sin(Δφ / 2) +
        Math.cos(φ1) * Math.cos(φ2) *
        Math.sin(Δλ / 2) * Math.sin(Δλ / 2);
    const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
    const distance = R * c;
    return distance;
}

// Helper function to calculate the midpoint latitude
function calculateMidLat(lat1, lat2) {
    return (lat1 + lat2) / 2;
}
// Helper function to calculate the midpoint longitude, handling wrap-around
function calculateMidLng(lng1, lng2) {
    let midLng = (lng1 + lng2) / 2;
    if (Math.abs(lng1 - lng2) > 180) {
        midLng += midLng < 0 ? 180 : -180;
    }
    return midLng;
}
// Helper function to calculate the appropriate altitude to fit the trip
function calculateFitAltitude(lat1, lng1, lat2, lng2, type) {
    const angularDistanceInRadians = calculateAngularDistanceRadians(lat1, lng1, lat2, lng2);
    // Map angular distance to altitude
    let minAltitude;
    let maxAltitude;
    let scaleFactor;
    if (type === 'FLYING') {
        // For flying trips, set altitude higher to show more of the globe
        minAltitude = 1.5; // Closer zoom for short trips
        maxAltitude = 4.0; // Farther zoom for long trips
        scaleFactor = 2.0; // Adjust this value to fine-tune the zoom effect
    } else {
        // For non-flying trips, zoom in more (i.e., lower altitude)
        minAltitude = 0.1; // Closer zoom for short trips
        maxAltitude = 1.5; // Farther zoom for long trips
        scaleFactor = 40.0; // Increase scaleFactor to zoom more
    }
    // Calculate altitude based on angular distance
    let altitude = Math.min(Math.max(angularDistanceInRadians * scaleFactor, minAltitude), maxAltitude);
    // Add in some randomness to make the globe more interesting, proportional to the angular distance
    const randomFactor = Math.random() * angularDistanceInRadians * 0.1;
    altitude += randomFactor;
    console.log(`Calculated altitude: ${altitude.toFixed(2)} for angular distance: ${angularDistanceInRadians.toFixed(4)} radians, type: ${type}`);
    return altitude;
}
// Helper function to calculate angular distance between two coordinates in radians
function calculateAngularDistanceRadians(lat1, lon1, lat2, lon2) {
    const toRadians = (deg) => (deg * Math.PI) / 180;
    const φ1 = toRadians(lat1);
    const φ2 = toRadians(lat2);
    const Δλ = toRadians(lon2 - lon1);
    const centralAngle = Math.acos(
        Math.sin(φ1) * Math.sin(φ2) + Math.cos(φ1) * Math.cos(φ2) * Math.cos(Δλ)
    );
    return centralAngle;
}
// Helper function to calculate transition duration based on angular distance
function calculateTransitionDuration(index, arcsData, midLat, midLng) {
    let transitionDuration = 500; // Default duration
    if (index > 0) {
        const prevTrip = arcsData[index - 1];
        const prevMidLat = calculateMidLat(prevTrip.startLat, prevTrip.endLat);
        const prevMidLng = calculateMidLng(prevTrip.startLng, prevTrip.endLng);
        const angleDist = angularDistance(prevMidLat, prevMidLng, midLat, midLng);
        // Adjust duration based on angular distance
        console.log(`Angular distance: ${angleDist.toFixed(4)} radians`);
        transitionDuration = Math.min(Math.max(angleDist * 150, 400), 900);
        console.log(`Calculated transition duration: ${transitionDuration} ms`);
    }
    return transitionDuration;
}
// Helper function to calculate angular distance between two points in degrees
function angularDistance(lat1, lng1, lat2, lng2) {
    // Returns the angular distance in degrees
    const dLat = Math.abs(lat1 - lat2);
    const dLng = Math.abs(lng1 - lng2);
    return Math.sqrt(dLat * dLat + dLng * dLng);
}