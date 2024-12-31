let cityData = []; // Array to hold city data

// Load city data from assets/world_cities.json
fetch('assets/cities.json')
  .then(response => response.json())
  .then(data => {
    cityData = data;
    console.log('City data loaded:', cityData.length, 'cities');
  })
  .catch(error => {
    console.error('Error loading city data:', error);
  });

/**
 * This function takes the new on-device JSON data
 * for google timeline and stores it in your browser's
 * indexedDB.
 * 
 * The data is an dictionary with the following structure:
 * {
 *  semanticSegments: [],
 *  rawSignals: [],
 *  userLocationProfile: []
 * }
 * 
 * We don't care about the rawSignals or userLocationProfile
 * so we're going to ignore those.
 * 
 * The data in semanticSegments is a list of dictionaries with the following structure:
 * {
 *   startTime: "YYYY-MM-DDTHH:MM:SS.SSS-TIMEZONE",
 *   endTime: "YYYY-MM-DDTHH:MM:SS.SSS-TIMEZONE",
 *   timelinePath: [
 *     {
 *       point: "LATITUDE, LONGITUDE",
 *       time: "YYYY-MM-DDTHH:MM:SS.SSS-TIMEZONE"
 *     },
 *    ...
 *   ],
 * }
 * 
 * 
 * OR
 * 
 * {
 *   startTime: "YYYY-MM-DDTHH:MM:SS.SSS-TIMEZONE",
 *   endTime: "YYYY-MM-DDTHH:MM:SS.SSS-TIMEZONE",
 *   startTimeTimezoneUtcOffsetMinutes: -480,
 *   endTimeTimezoneUtcOffsetMinutes: -480,
 *   activity: {
 *     start: {
 *      latLng: "LATITUDE, LONGITUDE"
 *   },
 *    end: {
 *     latLng: "LATITUDE, LONGITUDE"
 *   },
 *   distanceMeters: FLOAT,
 *   topCandidate: {
 *   type: CYCLING | FLYING | IN_BUS | IN_FERRY | IN_PASSENGER_VEHICLE 
 *          | IN_SUBWAY | IN_TRAIN | IN_TRAM | MOTORCYCLING | RUNNING
 *          | UNKNOWN_ACTIVITY_TYPE | WALKING,
 *   probability: FLOAT,
 * }
 * 
 * 
 * OR
 * 
 * 
 * {
 *   startTime: "YYYY-MM-DDTHH:MM:SS.SSS-TIMEZONE",
 *   endTime: "YYYY-MM-DDTHH:MM:SS.SSS-TIMEZONE",
 *   startTimeTimezoneUtcOffsetMinutes: -480,
 *   endTimeTimezoneUtcOffsetMinutes: -480,
 *   visit: {
 *     hierarchyLevel: INT,
 *     probability: FLOAT,
 *     topCandidate: {
 *       placeId: "PLACE_ID",
 *       semanticType: STRING,
 *       probability: FLOAT,
 *       placeLocation: {
 *         latLng: "LATITUDE, LONGITUDE"
 *       }
 *   }
 * }       
 * 
 * 
 * @param {Object} data The massive JSON object from the google timeline
 */
async function dataToIndexedDB(data) {
    const db = await idb.openDB('gmaps-wrapped', 1, {
        upgrade(db) {
            const timelineStore = db.createObjectStore('timeline', { keyPath: 'id', autoIncrement: true });
            if (!timelineStore.indexNames.contains('activity')) {
                timelineStore.createIndex('activity', 'activity.topCandidate.type', { unique: false });
            }

            const tripsStore = db.createObjectStore('trips', { keyPath: 'id', autoIncrement: true });
            if (!tripsStore.indexNames.contains('activity')) {
                tripsStore.createIndex('activity', 'activity.topCandidate.type', { unique: false });
            }
        }
    });

    console.log('Database opened successfully, adding data');
    const transaction = db.transaction('timeline', 'readwrite');
    const store = transaction.objectStore('timeline');
    const segments = data.semanticSegments;

    // If there's data in the store, clear it
    await store.clear();
    const uniqueModesOfTransport = {};

    const allSegments = [];
    for (const segment of segments) {
        // Print after every 1000 segments
        if (segments.indexOf(segment) % 100 === 0) {
            // Put the percentage in the trip-info div
            const cleanPercentage = Math.floor((segments.indexOf(segment) / segments.length) * 100);
            document.getElementById("trip-info").innerHTML = `Importing data... (${cleanPercentage}%)`;
        }
        await store.add(segment);

        if (segment.activity) {
            if (!uniqueModesOfTransport[segment.activity.topCandidate.type]) {
                uniqueModesOfTransport[segment.activity.topCandidate.type] = 0;
            }
            uniqueModesOfTransport[segment.activity.topCandidate.type] += 1;
        }
    }

    console.log('Unique modes of transport:', uniqueModesOfTransport);
    console.log('Data added successfully');

    // Close the transaction
    await transaction.done;
    db.close();
}



const defaultConfig = {
    "FLYING": {
        "distance": 0,
        "duration": 0
    },
    "IN_BUS": {
        "distance": 50,
        "duration": 60
    },
    "IN_FERRY": {
        "distance": 0,
        "duration": 0
    },
    "IN_PASSENGER_VEHICLE": {
        "distance": 100,
        "duration": 60
    },
    "IN_SUBWAY": {
        "distance": 50,
        "duration": 60
    },
    "IN_TRAIN": {
        "distance": 20,
        "duration": 30
    },
    "IN_TRAM": {
        "distance": 20,
        "duration": 30
    },
    "CYCLING": {
        "distance": 10,
        "duration": 0
    },
    "MOTORCYCLING": {
        "distance": 50,
        "duration": 0
    },
    "RUNNING": {
        "distance": 10,
        "duration": 0
    },
    "WALKING": {
        "distance": 5,
        "duration": 30
    }
}

function formatPopulation(population) {
    if (population > 1000000) {
        return `${(population / 1000000).toFixed(1)}M`;
    } else if (population > 1000) {
        return `${(population / 1000).toFixed(1)}K`;
    } else {
        return population;
    }
}

// Function to fetch city name from local city data
function getCityName(lat, lon) {
    // Find the nearest city within a reasonable distance
    const maxDistanceKm = 50; // Maximum distance to consider (in km)
    const minPopulation = 50000;

    let nearestCity = null;
    let bestScore = 0;

    const latRad = lat * Math.PI / 180;
    const lonRad = lon * Math.PI / 180;
    for (const city of cityData) {
        const cityLat = parseFloat(city.lat);
        const cityLon = parseFloat(city.lon);
        const cityLatRad = cityLat * Math.PI / 180;
        const cityLonRad = cityLon * Math.PI / 180;
        const deltaLat = cityLatRad - latRad;
        const deltaLon = cityLonRad - lonRad;
        const a = Math.sin(deltaLat / 2) ** 2 + Math.cos(latRad) * Math.cos(cityLatRad) * Math.sin(deltaLon / 2) ** 2;
        const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
        const distanceKm = c * 6371; // Distance in kilometers

        if (distanceKm > maxDistanceKm || city.population < minPopulation) {
            continue;
        }

        // We want to maximize the population and minimize the distance
        const score = city.population / Math.max(1, distanceKm);
        if (score >= bestScore) {
            nearestCity = city;
            bestScore = score;
        }
    }

    if (nearestCity) {
        return `${nearestCity.name} (${formatPopulation(nearestCity.population)})`;
    } else {
        return 'Unknown Location';
    }
}

async function findTrips(config = defaultConfig) {
    const db = await idb.openDB('gmaps-wrapped', 1);
    console.log('Database opened successfully, finding trips');
    const transaction = db.transaction('timeline', 'readwrite');
    const store = transaction.objectStore('timeline');
    const index = store.index('activity');

    const trips = {}

    let cursor = await index.openCursor();
    while (cursor) {
        const segment = cursor.value;
        if (segment.activity) {
            const activity = segment.activity;
            const type = activity.topCandidate.type;

            // Convert meters to miles
            const distance = activity.distanceMeters * 0.0006213712;

            // Convert milliseconds to minutes
            const duration = (new Date(segment.endTime) - new Date(segment.startTime)) / 60 / 1000;

            if (config[type] && (distance >= config[type].distance && duration >= config[type].duration)) {
                if (!trips[type]) {
                    trips[type] = [];
                }

                // Get start and end locations
                const startLocation = activity.start.latLng.split(',').map((x) => parseFloat(x.trim()));
                const endLocation = activity.end.latLng.split(',').map((x) => parseFloat(x.trim()));
                segment.startCity = getCityName(startLocation[0], startLocation[1]);
                segment.endCity = getCityName(endLocation[0], endLocation[1]);

                console.log(`${type} trip with length ${distance} miles and duration ${duration} minutes between ${segment.startCity} and ${segment.endCity}`);
                trips[type].push(segment);

                let totalTrips = 0;
                for (const type in trips) {
                    totalTrips += trips[type].length;
                }
                document.getElementById("trip-info").innerHTML = `Found ${totalTrips} trips, searching for more...`;
            }
        }
        cursor = await cursor.continue();
    }

    console.log('Trips:', trips);

    // Close the transaction
    await transaction.done;

    const tripTransaction = db.transaction('trips', 'readwrite');
    const tripStore = tripTransaction.objectStore('trips');

    await tripStore.clear();
    
    for (const type in trips) {
        for (const trip of trips[type]) {
            await tripStore.add(trip);
        }
    }

    await tripTransaction.done;

    db.close();
}
