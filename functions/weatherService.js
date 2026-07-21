const axios = require("axios");

const OWM_BASE = "https://api.openweathermap.org/data/2.5/weather";

async function getWeatherByCoords(lat, lon, apiKey) {
  const { data } = await axios.get(OWM_BASE, {
    params: { lat, lon, units: "metric", lang: "ja", appid: apiKey }
  });
  return formatWeather(data);
}

async function getWeatherByCity(city, apiKey) {
  const { data } = await axios.get(OWM_BASE, {
    params: { q: city, units: "metric", lang: "ja", appid: apiKey }
  });
  return formatWeather(data);
}

function formatWeather(d) {
  return {
    condition:     d.weather[0].main,
    conditionCode: d.weather[0].id,
    description:   d.weather[0].description,
    icon:          d.weather[0].icon,
    temp:          d.main.temp,
    feelsLike:     d.main.feels_like,
    humidity:      d.main.humidity,
    windSpeed:     d.wind.speed,
    cloudiness:    d.clouds.all,
    location:      `${d.name}, ${d.sys.country}`,
    lat:           d.coord.lat,
    lon:           d.coord.lon,
    fetchedAt:     new Date().toISOString()
  };
}

module.exports = { getWeatherByCoords, getWeatherByCity };
