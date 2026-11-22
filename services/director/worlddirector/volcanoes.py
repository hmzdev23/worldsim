"""Known volcanoes: a volcanic_eruption must happen at one of them.

A curated list of well-known volcanoes that erupted in the last ~10,000 years
(names and summit coordinates rounded from the Smithsonian Global Volcanism
Program). It is deliberately short: an eruption the model places anywhere
else is rejected, so the map never shows lava in a city or the open plains.
Add a volcano here if a scenario needs one that is missing.
"""

from __future__ import annotations

import math
from typing import NamedTuple, Optional

MAX_DISTANCE_KM = 50.0  # an eruption may name a nearby town; its point stays this close to the summit


class Volcano(NamedTuple):
    name: str
    country: str
    lat: float
    lon: float


VOLCANOES: tuple = tuple(Volcano(*row) for row in (
    # Iceland
    ("Fagradalsfjall", "Iceland", 63.90, -22.27),
    ("Svartsengi", "Iceland", 63.87, -22.42),
    ("Hekla", "Iceland", 63.98, -19.70),
    ("Katla", "Iceland", 63.63, -19.05),
    ("Eyjafjallajökull", "Iceland", 63.63, -19.62),
    ("Grímsvötn", "Iceland", 64.42, -17.33),
    ("Bárðarbunga", "Iceland", 64.64, -17.53),
    ("Askja", "Iceland", 65.03, -16.75),
    ("Krafla", "Iceland", 65.73, -16.78),
    # Europe and the Atlantic
    ("Vesuvius", "Italy", 40.82, 14.43),
    ("Campi Flegrei", "Italy", 40.83, 14.14),
    ("Etna", "Italy", 37.75, 15.00),
    ("Stromboli", "Italy", 38.79, 15.21),
    ("Vulcano", "Italy", 38.40, 14.96),
    ("Santorini", "Greece", 36.40, 25.40),
    ("Cumbre Vieja", "Spain", 28.57, -17.84),
    ("Teide", "Spain", 28.27, -16.64),
    ("Fogo", "Cabo Verde", 14.95, -24.35),
    ("Mount Ararat", "Türkiye", 39.70, 44.30),
    ("Damavand", "Iran", 35.95, 52.11),
    # North America
    ("Mount St. Helens", "United States", 46.20, -122.18),
    ("Mount Rainier", "United States", 46.85, -121.76),
    ("Mount Hood", "United States", 45.37, -121.70),
    ("Mount Shasta", "United States", 41.41, -122.19),
    ("Yellowstone", "United States", 44.43, -110.67),
    ("Long Valley", "United States", 37.70, -118.87),
    ("Kīlauea", "United States", 19.42, -155.29),
    ("Mauna Loa", "United States", 19.48, -155.61),
    ("Redoubt", "United States", 60.49, -152.74),
    ("Augustine", "United States", 59.36, -153.43),
    ("Pavlof", "United States", 55.42, -161.89),
    ("Popocatépetl", "Mexico", 19.02, -98.62),
    ("Colima", "Mexico", 19.51, -103.62),
    # Central America and the Caribbean
    ("Fuego", "Guatemala", 14.47, -90.88),
    ("Santa Ana", "El Salvador", 13.85, -89.63),
    ("Masaya", "Nicaragua", 11.98, -86.16),
    ("Arenal", "Costa Rica", 10.46, -84.70),
    ("Soufrière Hills", "Montserrat", 16.72, -62.18),
    ("Mount Pelée", "Martinique", 14.81, -61.17),
    ("La Soufrière", "Saint Vincent and the Grenadines", 13.33, -61.18),
    # South America
    ("Nevado del Ruiz", "Colombia", 4.89, -75.32),
    ("Galeras", "Colombia", 1.22, -77.37),
    ("Cotopaxi", "Ecuador", -0.68, -78.44),
    ("Tungurahua", "Ecuador", -1.47, -78.44),
    ("Ubinas", "Peru", -16.36, -70.90),
    ("El Misti", "Peru", -16.29, -71.41),
    ("Villarrica", "Chile", -39.42, -71.93),
    ("Calbuco", "Chile", -41.33, -72.62),
    ("Chaitén", "Chile", -42.83, -72.65),
    ("Puyehue-Cordón Caulle", "Chile", -40.59, -72.12),
    # Japan
    ("Mount Fuji", "Japan", 35.36, 138.73),
    ("Sakurajima", "Japan", 31.59, 130.66),
    ("Aso", "Japan", 32.88, 131.10),
    ("Unzen", "Japan", 32.76, 130.30),
    ("Ontake", "Japan", 35.89, 137.48),
    ("Asama", "Japan", 36.41, 138.52),
    ("Zao", "Japan", 38.14, 140.44),
    ("Usu", "Japan", 42.54, 140.84),
    # Southeast Asia and the Pacific
    ("Pinatubo", "Philippines", 15.13, 120.35),
    ("Mayon", "Philippines", 13.26, 123.69),
    ("Taal", "Philippines", 14.00, 120.99),
    ("Krakatau", "Indonesia", -6.10, 105.42),
    ("Merapi", "Indonesia", -7.54, 110.45),
    ("Tambora", "Indonesia", -8.25, 118.00),
    ("Agung", "Indonesia", -8.34, 115.51),
    ("Sinabung", "Indonesia", 3.17, 98.39),
    ("Kelud", "Indonesia", -7.93, 112.31),
    ("Semeru", "Indonesia", -8.11, 112.92),
    ("Toba", "Indonesia", 2.58, 98.83),
    ("Rabaul", "Papua New Guinea", -4.27, 152.20),
    ("Ambrym", "Vanuatu", -16.25, 168.12),
    ("Hunga Tonga-Hunga Ha'apai", "Tonga", -20.54, -175.38),
    ("Ruapehu", "New Zealand", -39.28, 175.57),
    ("Tongariro", "New Zealand", -39.13, 175.64),
    ("Taupō", "New Zealand", -38.82, 176.00),
    ("Whakaari / White Island", "New Zealand", -37.52, 177.18),
    # Russia
    ("Klyuchevskoy", "Russia", 56.06, 160.64),
    ("Shiveluch", "Russia", 56.65, 161.36),
    ("Bezymianny", "Russia", 55.97, 160.60),
    # Africa, the Indian Ocean and Antarctica
    ("Nyiragongo", "Democratic Republic of the Congo", -1.52, 29.25),
    ("Kilimanjaro", "Tanzania", -3.07, 37.35),
    ("Ol Doinyo Lengai", "Tanzania", -2.76, 35.91),
    ("Erta Ale", "Ethiopia", 13.60, 40.67),
    ("Mount Cameroon", "Cameroon", 4.20, 9.17),
    ("Piton de la Fournaise", "Réunion", -21.24, 55.71),
    ("Mount Erebus", "Antarctica", -77.53, 167.17),
))


def distance_km(lat1: float, lon1: float, lat2: float, lon2: float) -> float:
    """Great-circle distance in km."""
    p1, p2 = math.radians(lat1), math.radians(lat2)
    dp, dl = p2 - p1, math.radians(lon2 - lon1)
    a = math.sin(dp / 2) ** 2 + math.cos(p1) * math.cos(p2) * math.sin(dl / 2) ** 2
    return 2 * 6371.0 * math.asin(min(1.0, math.sqrt(a)))


def nearest_volcano(lat: float, lon: float) -> tuple:
    """(volcano, distance_km) of the closest known volcano."""
    return min(((v, distance_km(lat, lon, v.lat, v.lon)) for v in VOLCANOES), key=lambda pair: pair[1])


def volcano_at(lat: float, lon: float) -> Optional[Volcano]:
    """The known volcano within MAX_DISTANCE_KM of the point, or None."""
    volcano, km = nearest_volcano(lat, lon)
    return volcano if km <= MAX_DISTANCE_KM else None
