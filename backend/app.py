from flask import Flask, request, jsonify
from flask_cors import CORS
import requests
import time

app = Flask(__name__)
CORS(app)


def snap_to_road(lon, lat):

    try:
        url = f"http://router.project-osrm.org/nearest/v1/driving/{lon},{lat}"
        res = requests.get(url, timeout=5)
        data = res.json()
        return data["waypoints"][0]["location"]

    except:
        return [lon, lat]



@app.route("/route", methods=["POST"])
def route():

    data = request.json
    start = data.get("start")
    end = data.get("end")

    if not start or not end:
        return jsonify({"routes": [], "fallback": True})

    try:

        start = snap_to_road(start[0], start[1])
        end = snap_to_road(end[0], end[1])

        url = f"http://router.project-osrm.org/route/v1/driving/{start[0]},{start[1]};{end[0]},{end[1]}"

        params = {"overview": "full", "geometries": "geojson"}

        route_data = {}

        for _ in range(3):

            try:
                res = requests.get(url, params=params, timeout=8)
                route_data = res.json()
                if "routes" in route_data:
                    break

            except:
                pass

            time.sleep(0.3)

        if "routes" not in route_data:
            return jsonify({"routes": [[start, end]], "fallback": True})

        base_route = route_data["routes"][0]["geometry"]["coordinates"]

        midpoint = base_route[len(base_route)//2]

        alt_route = [
            base_route[0],
            [midpoint[0] + 0.01, midpoint[1] + 0.01],
            base_route[-1]
        ]

        return jsonify({"routes": [base_route, alt_route], "fallback": False})

    except:
        return jsonify({"routes": [[start, end]], "fallback": True})



@app.route("/crime", methods=["GET"])
def crime():

    crime_points = [
        {"lat": 13.0827, "lng": 80.2707},
        {"lat": 13.0674, "lng": 80.2376},
        {"lat": 13.0500, "lng": 80.2200}
    ]

    return jsonify({"data": crime_points})



@app.route("/feedback", methods=["POST"])
def feedback():

    data = request.json
    print("✅ Feedback:", data)

    return jsonify({"status": "saved"})

@app.route("/")
def home():
    return "Phase 4 Backend Running ✅"

if __name__ == "__main__":
    app.run(debug=True)