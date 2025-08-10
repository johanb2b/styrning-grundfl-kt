README – Krypgrundsfläkt med BTHome (AF + temperaturvillkor)

Syfte

Ventilera endast när det verkligen hjälper en riskkonstruktion (70-talskrypgrund) och undvika att dra in varm/fuktig sommaruft som kan kondendera. Scriptet kör fläkten när uteluften är både torrare och svalare än luften i grunden – annars står den.

Hur sensorerna läses

BTHome: Shellyn lyssnar på BLE-annonser och cachar senaste värden (stabilare än direkt BLE i skript).

Scriptet hämtar:

Ute: Temp (ID 202), RF (ID 201)

Krypgrund: Temp (ID 205), RF (ID 204)


Loggar även ålder på alla mätvärden samt RSSI per sensor (felsökning och räckviddskoll).


Beslutslogik (start/stop)

1. Frysskydd: Om T_ute < MIN_OUTDOOR_TEMP (2°C) → stopp (aldrig start).


2. Torr krypgrund: Om RF_inne < MIN_INDOOR_RH_TARGET (60%) → stopp (ingen anledning att ventilera).


3. Säker ventilation (krav för start)
Fläkten får starta endast om båda gäller:

Torrare ute: AF_ute < AF_inne – HYST
där HYST = FAN_ON_HYSTERESIS (1.0 g/m³)
och + EXTRA_HYST_EMERG_OUT (1.0 g/m³) om utedata är i nöd-läge (se nedan).

Svalare ute: T_ute < T_inne



4. Stoppa när villkoren brister
Om fläkten redan går och något av ovan inte längre gäller → stopp (efter att minsta gångtid är uppfylld, se anti-chatter).



Varför just så här i ett 70-talshus?

På sommaren är uteluft ofta varm och fuktig. Om den sugs in i en kallare krypgrund riskerar den att avge fukt (kondens).

Därför kräver vi lägre absolut fuktighet (faktiskt fuktinnehåll) och lägre temperatur ute innan vi ventilerar.

Vi stänger också av när grunden redan är tillräckligt torr (RF < 60%) – onödig ventilation ger bara risk och energiförlust.


Nöd-lägen & robusthet

Nöd-läge inne/ute: Om ett sensorvärde saknas eller är för gammalt (äldre än MAX_AGE_* = 3600s), antas konservativa värden:

Inne: 15°C / 85% RF

Ute: 10°C / 80% RF


Vid nöd-läge för ute ökas startkravet (extra hysteres) så att vi inte startar på chans när utedata är osäkert.

Om data saknas helt även efter nöd-läge → ingen åtgärd den cykeln (failsafe).


Anti-chatter (minsta gång-/vilotider)

MIN_ON_TIME_S = 1800 s (30 min): Har fläkten väl startat, måste den ha gått i minst 30 min innan avstängning tillåts.

MIN_OFF_TIME_S = 1800 s (30 min): Har fläkten stannat, måste den stå i minst 30 min innan den får starta igen.

Scriptet loggar när blockeringen hindrar en ändring (med sekunder kvar) och när blockeringen släpper.


Loggning (för förståelse och felsök)

Visar inne/ute: temp, RF, AF (g/m³), ålder per värde och RSSI per device.

Skriver ut vilka villkor (torrare/svalare) som var sanna/falska vid beslutet.

Loggar tydligt orsak till start/stopp och om anti-chatter blockerar just nu.


Parametrar (kan justeras)

FAN_ON_HYSTERESIS = 1.0 g/m³ – basmarginal för ”torrare ute”.

EXTRA_HYST_EMERG_OUT = 1.0 g/m³ – extra marginal om ute i nöd-läge.

MIN_OUTDOOR_TEMP = 2°C – frysskydd, aldrig ventilera under denna ute-temp.

MIN_INDOOR_RH_TARGET = 60% – torrgräns för grunden.

MAX_AGE_INDOOR_S / MAX_AGE_OUTDOOR_S = 3600 s – maxålder innan nöd-läge aktiveras.

MIN_ON_TIME_S / MIN_OFF_TIME_S = 1800 s – anti-chatter.


Exempel – varför stoppar/startar den?

Sommarvarmt, 26°C ute / 18°C inne, AF_ute ≈ AF_inne → Stoppar/Startar ej (inte svalare ute; kondensrisk).

Höstkväll, 10°C ute / 15°C inne, AF_ute 6 g/m³, AF_inne 8 g/m³ → Startar (torrare och svalare ute + marginal).

Efter 40 min sjunker skillnaden → Stoppar (villkoren bryts; min on-tid uppfylld).


Tips för din installation

RSSI: om ute-RSSI är svagt (t.ex. −90 dBm), överväg att flytta sensorn/Shellyn eller lägga till en BLE-gateway närmare.

Sommarstrategi: om du vill vara extra försiktig juni–aug, kan vi lägga till tidsstyrda spärrar (t.ex. stoppa dagtid om inte AF-skillnaden är mycket stor).

Avfuktare: i många 70-talsgrunder blir det bäst med avfuktare + lätt trycksättning, där fläkten mest hjälper att distribuera torr luft.


Felsök snabbguide

Ser du NÖD i loggen ofta? → Kolla sensorålder och RSSI.

Fläkten ”vill starta” men blockeras? → Läs raderna om MIN_OFF_TIME; vänta tills blockeringen släpper (loggas med ✅).

Verkar beslutet ”fel”? → Kolla loggrad: Villkor: drier=true/false, cooler=true/false, hyst=… och jämför AF/T-värdena som skrivs ut.



---

Vill du att jag lägger in en ”sommarspärr” eller en CSV-logg (t.ex. via HTTP) för att spara AF/Temp/RH per cykel och analysera över tid? Jag kan fixa en variant direkt.

