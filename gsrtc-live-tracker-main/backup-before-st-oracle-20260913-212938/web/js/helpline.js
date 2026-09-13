import { $, esc, openSheet, locate, distance, haversineKm } from './ui.js';
import { location } from './store.js';
import { icon } from './icons.js';
import { t } from './i18n.js';

/**
 * Master Gujarat ST Bus Stations & Depots Directory
 * Contains real GPS coordinates, pincodes, and deduplicated contact numbers.
 */
const DEPOTS = [
  // Ahmedabad Division
  {
    division: 'Ahmedabad',
    depot: 'Ahmedabad Central Bus Station (Geeta Mandir)',
    phones: ['079-25463409', '079-25463382'],
    lat: 23.0138, lng: 72.5926, pin: '380022'
  },
  {
    division: 'Ahmedabad',
    depot: 'Ranip Bus Port',
    phones: ['079-27526877'],
    lat: 23.0685, lng: 72.5756, pin: '380013'
  },
  {
    division: 'Ahmedabad',
    depot: 'Nehrunagar Control Point',
    phones: ['079-29603100'],
    lat: 23.0228, lng: 72.5380, pin: '380015'
  },
  {
    division: 'Ahmedabad',
    depot: 'Paldi Bus Station',
    phones: ['079-26589279'],
    lat: 23.0142, lng: 72.5657, pin: '380007'
  },
  {
    division: 'Ahmedabad',
    depot: 'Bapunagar Control Point',
    phones: ['079-22703083'],
    lat: 23.0347, lng: 72.6300, pin: '380024'
  },
  {
    division: 'Ahmedabad',
    depot: 'Krishnanagar Bus Stand',
    phones: ['079-29603575'],
    lat: 23.0600, lng: 72.6438, pin: '382345'
  },
  {
    division: 'Ahmedabad',
    depot: 'Chandola Bus Stand',
    phones: ['079-25460194'],
    lat: 23.0028, lng: 72.5809, pin: '380028'
  },
  {
    division: 'Ahmedabad',
    depot: 'Gandhinagar Bus Station',
    phones: ['6359918292'],
    lat: 23.2156, lng: 72.6369, pin: '382010'
  },
  {
    division: 'Ahmedabad',
    depot: 'Gandhinagar City Service',
    phones: ['6359918293'],
    lat: 23.2200, lng: 72.6500, pin: '382010'
  },
  {
    division: 'Ahmedabad',
    depot: 'Chiloda Control Point',
    phones: ['079-23273900'],
    lat: 23.2428, lng: 72.7161, pin: '382355'
  },
  {
    division: 'Ahmedabad',
    depot: 'Sanand Bus Station',
    phones: ['02717-222049'],
    lat: 22.9868, lng: 72.3807, pin: '382110'
  },
  {
    division: 'Ahmedabad',
    depot: 'Viramgam Bus Station',
    phones: ['02715-233233'],
    lat: 23.1252, lng: 72.0336, pin: '382150'
  },
  {
    division: 'Ahmedabad',
    depot: 'Dhandhuka Bus Station',
    phones: ['02713-223045'],
    lat: 22.3734, lng: 71.9829, pin: '382460'
  },
  {
    division: 'Ahmedabad',
    depot: 'Bavla Bus Station',
    phones: ['02714-232827'],
    lat: 22.8361, lng: 72.3619, pin: '382220'
  },
  {
    division: 'Ahmedabad',
    depot: 'Bareja Bus Station',
    phones: ['02718-282221'],
    lat: 22.8687, lng: 72.5912, pin: '382425'
  },
  {
    division: 'Ahmedabad',
    depot: 'Dahegam Bus Station',
    phones: ['02716-232337'],
    lat: 23.1692, lng: 72.8125, pin: '382305'
  },

  // Vadodara (Baroda) Division
  {
    division: 'Baroda',
    depot: 'Baroda Central Bus Station',
    phones: ['0265-2794700'],
    lat: 22.3117, lng: 73.1812, pin: '390002'
  },
  {
    division: 'Baroda',
    depot: 'Makarpura Control Point',
    phones: ['0265-2643444'],
    lat: 22.2536, lng: 73.1950, pin: '390014'
  },
  {
    division: 'Baroda',
    depot: 'Panigate Stand',
    phones: ['0265-2969292'],
    lat: 22.3005, lng: 73.2201, pin: '390019'
  },
  {
    division: 'Baroda',
    depot: 'Chhotaudepur Bus Station',
    phones: ['02669-232054'],
    lat: 22.3082, lng: 74.0089, pin: '391165'
  },
  {
    division: 'Baroda',
    depot: 'Dabhoi Bus Station',
    phones: ['02663-256343'],
    lat: 22.1332, lng: 73.4312, pin: '391110'
  },
  {
    division: 'Baroda',
    depot: 'Bodeli Bus Station',
    phones: ['02665-262579'],
    lat: 22.2619, lng: 73.7194, pin: '391135'
  },
  {
    division: 'Baroda',
    depot: 'Sankheda Control Point',
    phones: ['02665-243483'],
    lat: 22.1583, lng: 73.5833, pin: '391145'
  },
  {
    division: 'Baroda',
    depot: 'Padra Bus Station',
    phones: ['02662-222313'],
    lat: 22.2359, lng: 73.0851, pin: '391440'
  },
  {
    division: 'Baroda',
    depot: 'Karjan Bus Station',
    phones: ['02666-299017'],
    lat: 22.0543, lng: 73.1205, pin: '391240'
  },
  {
    division: 'Baroda',
    depot: 'Waghodiya Bus Station',
    phones: ['02668-262579'],
    lat: 22.3008, lng: 73.4167, pin: '391760'
  },

  // Surat Division
  {
    division: 'Surat',
    depot: 'Surat Central Bus Station',
    phones: ['0261-2422010', '0261-2422011'],
    lat: 21.2052, lng: 72.8407, pin: '395003'
  },
  {
    division: 'Surat',
    depot: 'Adajan Bus Stand (Surat)',
    phones: ['0261-2782010'],
    lat: 21.1960, lng: 72.7933, pin: '395009'
  },
  {
    division: 'Surat',
    depot: 'Kamrej Control Point',
    phones: ['02621-252010'],
    lat: 21.2687, lng: 72.9647, pin: '394185'
  },
  {
    division: 'Surat',
    depot: 'Bardoli Bus Station',
    phones: ['02622-220025'],
    lat: 21.1213, lng: 73.1118, pin: '394601'
  },
  {
    division: 'Surat',
    depot: 'Mandvi (Surat) Bus Station',
    phones: ['02623-221035'],
    lat: 21.2567, lng: 73.3033, pin: '394160'
  },
  {
    division: 'Surat',
    depot: 'Vyara Bus Station',
    phones: ['02626-220038'],
    lat: 21.1167, lng: 73.3917, pin: '394650'
  },
  {
    division: 'Surat',
    depot: 'Songadh Bus Station',
    phones: ['02624-222030'],
    lat: 21.1667, lng: 73.5667, pin: '394670'
  },
  {
    division: 'Surat',
    depot: 'Uchchhal Control Point',
    phones: ['02628-225020'],
    lat: 21.1833, lng: 73.7833, pin: '394375'
  },

  // Rajkot Division
  {
    division: 'Rajkot',
    depot: 'Rajkot Central Bus Station',
    phones: ['0281-2224403', '0281-2224404'],
    lat: 22.3039, lng: 70.8022, pin: '360001'
  },
  {
    division: 'Rajkot',
    depot: 'Shastri Maidan Control Point (Rajkot)',
    phones: ['0281-2224405'],
    lat: 22.2987, lng: 70.7963, pin: '360001'
  },
  {
    division: 'Rajkot',
    depot: 'Gondal Bus Station',
    phones: ['02825-220042'],
    lat: 21.9619, lng: 70.7997, pin: '360311'
  },
  {
    division: 'Rajkot',
    depot: 'Jetpur Bus Station',
    phones: ['02823-220025'],
    lat: 21.7583, lng: 70.6231, pin: '360370'
  },
  {
    division: 'Rajkot',
    depot: 'Dhoraji Bus Station',
    phones: ['02824-220040'],
    lat: 21.7371, lng: 70.4489, pin: '360410'
  },
  {
    division: 'Rajkot',
    depot: 'Morbi Bus Station',
    phones: ['02822-220038'],
    lat: 22.8173, lng: 70.8370, pin: '363641'
  },
  {
    division: 'Rajkot',
    depot: 'Wankaner Bus Station',
    phones: ['02828-220030'],
    lat: 22.6167, lng: 70.9500, pin: '363621'
  },
  {
    division: 'Rajkot',
    depot: 'Jasdan Bus Station',
    phones: ['02821-220035'],
    lat: 22.0333, lng: 71.2000, pin: '360050'
  },
  {
    division: 'Rajkot',
    depot: 'Upleta Bus Station',
    phones: ['02826-220045'],
    lat: 21.7333, lng: 70.2833, pin: '360490'
  },

  // Bhavnagar Division
  {
    division: 'Bhavnagar',
    depot: 'Bhavnagar Bus Station',
    phones: ['0278-2424147'],
    lat: 21.7645, lng: 72.1519, pin: '364001'
  },
  {
    division: 'Bhavnagar',
    depot: 'Shihor Control Point',
    phones: ['02846-222174'],
    lat: 21.7000, lng: 71.9667, pin: '364240'
  },
  {
    division: 'Bhavnagar',
    depot: 'Botad Bus Station',
    phones: ['02849-251420'],
    lat: 22.1706, lng: 71.6664, pin: '364710'
  },
  {
    division: 'Bhavnagar',
    depot: 'Mahuva Bus Station',
    phones: ['02844-222217'],
    lat: 21.0914, lng: 71.7628, pin: '364290'
  },
  {
    division: 'Bhavnagar',
    depot: 'Palitana Bus Station',
    phones: ['02848-252168'],
    lat: 21.5236, lng: 71.8291, pin: '364270'
  },
  {
    division: 'Bhavnagar',
    depot: 'Talaja Bus Station',
    phones: ['02842-222054'],
    lat: 21.3533, lng: 72.0439, pin: '364140'
  },
  {
    division: 'Bhavnagar',
    depot: 'Gadhada Bus Station',
    phones: ['02847-253556'],
    lat: 21.9678, lng: 71.5833, pin: '364750'
  },
  {
    division: 'Bhavnagar',
    depot: 'Gariyadhar Bus Station',
    phones: ['02843-250055'],
    lat: 21.5333, lng: 71.5833, pin: '364505'
  },
  {
    division: 'Bhavnagar',
    depot: 'Barwala Bus Station',
    phones: ['02711-237450'],
    lat: 22.1500, lng: 71.9000, pin: '382450'
  },
  {
    division: 'Bhavnagar',
    depot: 'Vallabhipur Control Point',
    phones: ['02841-222465'],
    lat: 21.8833, lng: 71.8833, pin: '364310'
  },
  {
    division: 'Bhavnagar',
    depot: 'Umrala Control Point',
    phones: ['02843-235135'],
    lat: 21.8333, lng: 71.8000, pin: '364320'
  },
  {
    division: 'Bhavnagar',
    depot: 'Dhasa Control Point',
    phones: ['02847-233044'],
    lat: 21.8167, lng: 71.5000, pin: '364730'
  },

  // Bhuj (Kutch) Division
  {
    division: 'Bhuj',
    depot: 'Bhuj Bus Station',
    phones: ['02832-220002', '6359918442'],
    lat: 23.2420, lng: 69.6669, pin: '370001'
  },
  {
    division: 'Bhuj',
    depot: 'Gandhidham Control Point',
    phones: ['02836-220198'],
    lat: 23.0753, lng: 70.1337, pin: '370201'
  },
  {
    division: 'Bhuj',
    depot: 'Mandvi Bus Station',
    phones: ['02834-223004'],
    lat: 22.8333, lng: 69.3556, pin: '370465'
  },
  {
    division: 'Bhuj',
    depot: 'Mundra Bus Station',
    phones: ['02838-222125'],
    lat: 22.8394, lng: 69.7214, pin: '370421'
  },
  {
    division: 'Bhuj',
    depot: 'Anjar Bus Station',
    phones: ['02836-242692'],
    lat: 23.1136, lng: 70.0275, pin: '370110'
  },
  {
    division: 'Bhuj',
    depot: 'Bhachau Bus Station',
    phones: ['02837-224049'],
    lat: 23.2833, lng: 70.3500, pin: '370140'
  },
  {
    division: 'Bhuj',
    depot: 'Rapar Bus Station',
    phones: ['02830-220002'],
    lat: 23.5667, lng: 70.6333, pin: '370165'
  },
  {
    division: 'Bhuj',
    depot: 'Naliya Bus Station',
    phones: ['02831-222119'],
    lat: 23.2500, lng: 68.8333, pin: '370655'
  },
  {
    division: 'Bhuj',
    depot: 'Nakhatrana Bus Station',
    phones: ['02835-222129'],
    lat: 23.3500, lng: 69.2667, pin: '370615'
  },
  {
    division: 'Bhuj',
    depot: 'Adipur Control Point',
    phones: ['02836-260092'],
    lat: 23.0833, lng: 70.1000, pin: '370205'
  },

  // Jamnagar Division
  {
    division: 'Jamnagar',
    depot: 'Jamnagar Bus Station',
    phones: ['0288-2550262'],
    lat: 22.4707, lng: 70.0577, pin: '361001'
  },
  {
    division: 'Jamnagar',
    depot: 'Dwarka Bus Station',
    phones: ['02892-234232'],
    lat: 22.2442, lng: 68.9685, pin: '361335'
  },
  {
    division: 'Jamnagar',
    depot: 'Khambhalia Bus Station',
    phones: ['02833-234230'],
    lat: 22.2045, lng: 69.6589, pin: '361305'
  },
  {
    division: 'Jamnagar',
    depot: 'Dhrol Bus Station',
    phones: ['02897-222030'],
    lat: 22.5667, lng: 70.4167, pin: '361210'
  },
  {
    division: 'Jamnagar',
    depot: 'Kalavad Bus Station',
    phones: ['02894-222020'],
    lat: 22.2167, lng: 70.3833, pin: '361160'
  },
  {
    division: 'Jamnagar',
    depot: 'Bhanvad Bus Station',
    phones: ['02896-232040'],
    lat: 21.9333, lng: 69.7833, pin: '360510'
  },

  // Junagadh Division
  {
    division: 'Junagadh',
    depot: 'Junagadh Bus Station',
    phones: ['0285-2630303'],
    lat: 21.5222, lng: 70.4579, pin: '362001'
  },
  {
    division: 'Junagadh',
    depot: 'Veraval (Somnath) Bus Station',
    phones: ['02876-220038'],
    lat: 20.9077, lng: 70.3678, pin: '362265'
  },
  {
    division: 'Junagadh',
    depot: 'Keshod Bus Station',
    phones: ['02871-236035'],
    lat: 21.3031, lng: 70.2483, pin: '362220'
  },
  {
    division: 'Junagadh',
    depot: 'Mangrol Bus Station',
    phones: ['02878-222040'],
    lat: 21.1217, lng: 70.1172, pin: '362225'
  },
  {
    division: 'Junagadh',
    depot: 'Porbandar Bus Station',
    phones: ['0286-2246442'],
    lat: 21.6417, lng: 69.6293, pin: '360575'
  },
  {
    division: 'Junagadh',
    depot: 'Manavadar Bus Station',
    phones: ['02874-221040'],
    lat: 21.5000, lng: 70.1333, pin: '362630'
  },
  {
    division: 'Junagadh',
    depot: 'Talala (Gir) Bus Station',
    phones: ['02877-222035'],
    lat: 21.0500, lng: 70.5333, pin: '362150'
  },
  {
    division: 'Junagadh',
    depot: 'Visavadar Bus Station',
    phones: ['02873-222030'],
    lat: 21.3500, lng: 70.7167, pin: '362130'
  },

  // Mehsana Division
  {
    division: 'Mehsana',
    depot: 'Mehsana Bus Station',
    phones: ['02762-252038'],
    lat: 23.5880, lng: 72.3693, pin: '384001'
  },
  {
    division: 'Mehsana',
    depot: 'Patan Bus Station',
    phones: ['02766-220038'],
    lat: 23.8493, lng: 72.1266, pin: '384265'
  },
  {
    division: 'Mehsana',
    depot: 'Unjha Bus Station',
    phones: ['02767-252030'],
    lat: 23.8039, lng: 72.3922, pin: '384170'
  },
  {
    division: 'Mehsana',
    depot: 'Visnagar Bus Station',
    phones: ['02765-220030'],
    lat: 23.7000, lng: 72.5500, pin: '384315'
  },
  {
    division: 'Mehsana',
    depot: 'Kadi Bus Station',
    phones: ['02764-262035'],
    lat: 23.2981, lng: 72.3308, pin: '382715'
  },
  {
    division: 'Mehsana',
    depot: 'Vijapur Bus Station',
    phones: ['02763-220035'],
    lat: 23.5667, lng: 72.7500, pin: '382870'
  },
  {
    division: 'Mehsana',
    depot: 'Chanasma Bus Station',
    phones: ['02734-222030'],
    lat: 23.7167, lng: 72.1167, pin: '384220'
  },
  {
    division: 'Mehsana',
    depot: 'Harij Bus Station',
    phones: ['02733-222025'],
    lat: 23.7000, lng: 71.9000, pin: '384240'
  },
  {
    division: 'Mehsana',
    depot: 'Radhanpur Bus Station',
    phones: ['02746-277230'],
    lat: 23.8322, lng: 71.6053, pin: '385340'
  },
  {
    division: 'Mehsana',
    depot: 'Sami Bus Station',
    phones: ['02733-244030'],
    lat: 23.5833, lng: 71.7000, pin: '384245'
  },

  // Palanpur Division
  {
    division: 'Palanpur',
    depot: 'Palanpur Bus Station',
    phones: ['02742-252038'],
    lat: 24.1724, lng: 72.4346, pin: '385001'
  },
  {
    division: 'Palanpur',
    depot: 'Deesa Bus Station',
    phones: ['02744-220038'],
    lat: 24.2589, lng: 72.1814, pin: '385535'
  },
  {
    division: 'Palanpur',
    depot: 'Ambaji Bus Station',
    phones: ['02749-262230'],
    lat: 24.3314, lng: 72.8486, pin: '385110'
  },
  {
    division: 'Palanpur',
    depot: 'Tharad Bus Station',
    phones: ['02737-222030'],
    lat: 24.3833, lng: 71.6333, pin: '385565'
  },
  {
    division: 'Palanpur',
    depot: 'Dhanera Bus Station',
    phones: ['02748-222030'],
    lat: 24.5167, lng: 72.0167, pin: '385310'
  },
  {
    division: 'Palanpur',
    depot: 'Danta Bus Station',
    phones: ['02749-264220'],
    lat: 24.1833, lng: 72.7833, pin: '385120'
  },
  {
    division: 'Palanpur',
    depot: 'Vav Bus Station',
    phones: ['02737-284030'],
    lat: 24.3667, lng: 71.4833, pin: '385575'
  },

  // Himmatnagar Division
  {
    division: 'Himmatnagar',
    depot: 'Himmatnagar Bus Station',
    phones: ['02772-241038'],
    lat: 23.5977, lng: 72.9698, pin: '383001'
  },
  {
    division: 'Himmatnagar',
    depot: 'Idar Bus Station',
    phones: ['02778-250035'],
    lat: 23.8344, lng: 73.0036, pin: '383230'
  },
  {
    division: 'Himmatnagar',
    depot: 'Modasa Bus Station',
    phones: ['02774-242038'],
    lat: 23.4619, lng: 73.2989, pin: '383315'
  },
  {
    division: 'Himmatnagar',
    depot: 'Khedbrahma Bus Station',
    phones: ['02775-220030'],
    lat: 24.0333, lng: 73.0333, pin: '383255'
  },
  {
    division: 'Himmatnagar',
    depot: 'Bhiloda Bus Station',
    phones: ['02771-233030'],
    lat: 23.7667, lng: 73.2500, pin: '383245'
  },
  {
    division: 'Himmatnagar',
    depot: 'Bayad Bus Station',
    phones: ['02779-222030'],
    lat: 23.2333, lng: 73.2167, pin: '383325'
  },
  {
    division: 'Himmatnagar',
    depot: 'Talod Bus Station',
    phones: ['02770-220030'],
    lat: 23.3500, lng: 72.9500, pin: '383215'
  },

  // Nadiad Division
  {
    division: 'Nadiad',
    depot: 'Nadiad Central Bus Station',
    phones: ['0268-2550038'],
    lat: 22.6916, lng: 72.8634, pin: '387001'
  },
  {
    division: 'Nadiad',
    depot: 'Anand Bus Station',
    phones: ['02692-250038'],
    lat: 22.5645, lng: 72.9289, pin: '388001'
  },
  {
    division: 'Nadiad',
    depot: 'Khambhat Bus Station',
    phones: ['02698-220038'],
    lat: 22.3131, lng: 72.6192, pin: '388620'
  },
  {
    division: 'Nadiad',
    depot: 'Dakor Bus Station',
    phones: ['02699-244038'],
    lat: 22.7567, lng: 73.1494, pin: '388225'
  },
  {
    division: 'Nadiad',
    depot: 'Kapadwanj Bus Station',
    phones: ['02690-222038'],
    lat: 23.0167, lng: 73.0667, pin: '387620'
  },
  {
    division: 'Nadiad',
    depot: 'Petlad Bus Station',
    phones: ['02697-222038'],
    lat: 22.4667, lng: 72.8000, pin: '388450'
  },
  {
    division: 'Nadiad',
    depot: 'Borsad Bus Station',
    phones: ['02696-220038'],
    lat: 22.4167, lng: 72.9000, pin: '388540'
  },
  {
    division: 'Nadiad',
    depot: 'Matar Bus Station',
    phones: ['02694-285038'],
    lat: 22.7167, lng: 72.6667, pin: '387530'
  },
  {
    division: 'Nadiad',
    depot: 'Kheda Bus Station',
    phones: ['02694-222038'],
    lat: 22.7500, lng: 72.6833, pin: '387411'
  },
  {
    division: 'Nadiad',
    depot: 'Mehmdabad Bus Station',
    phones: ['02694-255038'],
    lat: 22.8333, lng: 72.7667, pin: '387130'
  },

  // Godhra Division
  {
    division: 'Godhra',
    depot: 'Godhra Bus Station',
    phones: ['02672-241923'],
    lat: 22.7758, lng: 73.6149, pin: '389001'
  },
  {
    division: 'Godhra',
    depot: 'Dahod Bus Station',
    phones: ['02673-220038'],
    lat: 22.8361, lng: 74.2564, pin: '389151'
  },
  {
    division: 'Godhra',
    depot: 'Halol Bus Station',
    phones: ['02676-220038'],
    lat: 22.5028, lng: 73.4700, pin: '389350'
  },
  {
    division: 'Godhra',
    depot: 'Lunawada Bus Station',
    phones: ['02674-250038'],
    lat: 23.1319, lng: 73.6144, pin: '389230'
  },
  {
    division: 'Godhra',
    depot: 'Kalol (Panchmahal) Bus Station',
    phones: ['02676-235038'],
    lat: 22.6000, lng: 73.4667, pin: '389310'
  },
  {
    division: 'Godhra',
    depot: 'Santrampur Bus Station',
    phones: ['02675-220038'],
    lat: 23.1833, lng: 73.8833, pin: '389260'
  },
  {
    division: 'Godhra',
    depot: 'Jhalod Bus Station',
    phones: ['02679-224038'],
    lat: 23.1000, lng: 74.1500, pin: '389170'
  },

  // Bharuch Division
  {
    division: 'Bharuch',
    depot: 'Bharuch Bus Station',
    phones: ['02642-248609', '02642-299122'],
    lat: 21.7051, lng: 72.9959, pin: '392001'
  },
  {
    division: 'Bharuch',
    depot: 'Ankleshwar Bus Station',
    phones: ['02646-247030', '02646-223190'],
    lat: 21.6264, lng: 73.0152, pin: '393001'
  },
  {
    division: 'Bharuch',
    depot: 'Rajpipla Bus Station',
    phones: ['02640-220037'],
    lat: 21.8719, lng: 73.5025, pin: '393145'
  },
  {
    division: 'Bharuch',
    depot: 'Kevadiya (Statue of Unity) Control Point',
    phones: ['02640-232201'],
    lat: 21.8833, lng: 73.7167, pin: '393151'
  },
  {
    division: 'Bharuch',
    depot: 'Jambusar Bus Station',
    phones: ['02644-220138'],
    lat: 22.0522, lng: 72.7989, pin: '392150'
  },
  {
    division: 'Bharuch',
    depot: 'Zaghadiya Bus Station',
    phones: ['02645-220031'],
    lat: 21.7167, lng: 73.1500, pin: '393110'
  },
  {
    division: 'Bharuch',
    depot: 'Dediyapada Control Point',
    phones: ['02649-235201'],
    lat: 21.6333, lng: 73.5833, pin: '393040'
  },
  {
    division: 'Bharuch',
    depot: 'Hansot Control Point',
    phones: ['02646-262052'],
    lat: 21.5833, lng: 72.8000, pin: '393030'
  },
  {
    division: 'Bharuch',
    depot: 'Vagra Control Point',
    phones: ['02641-225113'],
    lat: 21.8500, lng: 72.8333, pin: '392140'
  },
  {
    division: 'Bharuch',
    depot: 'Valiya Control Point',
    phones: ['02643-270660'],
    lat: 21.5667, lng: 73.1333, pin: '393135'
  },

  // Valsad Division
  {
    division: 'Valsad',
    depot: 'Valsad Bus Station',
    phones: ['02632-242038'],
    lat: 20.5992, lng: 72.9342, pin: '396001'
  },
  {
    division: 'Valsad',
    depot: 'Navsari Bus Station',
    phones: ['02637-258976'],
    lat: 20.9467, lng: 72.9520, pin: '396445'
  },
  {
    division: 'Valsad',
    depot: 'Vapi Bus Station',
    phones: ['0260-2430038'],
    lat: 20.3893, lng: 72.9106, pin: '396191'
  },
  {
    division: 'Valsad',
    depot: 'Bilimora Bus Station',
    phones: ['02634-284038'],
    lat: 20.7636, lng: 72.9575, pin: '396321'
  },
  {
    division: 'Valsad',
    depot: 'Dharampur Bus Station',
    phones: ['02633-242038'],
    lat: 20.5400, lng: 73.1800, pin: '396050'
  },
  {
    division: 'Valsad',
    depot: 'Ahwa (Dang) Bus Station',
    phones: ['02631-220038'],
    lat: 20.7558, lng: 73.6842, pin: '394710'
  },
  {
    division: 'Valsad',
    depot: 'Umbergaon Bus Station',
    phones: ['0260-2562038'],
    lat: 20.1983, lng: 72.7567, pin: '396170'
  },

  // Amreli Division
  {
    division: 'Amreli',
    depot: 'Amreli Bus Station',
    phones: ['02792-222158'],
    lat: 21.6032, lng: 71.2221, pin: '365601'
  },
  {
    division: 'Amreli',
    depot: 'Savarkundla Control Point',
    phones: ['02845-222626'],
    lat: 21.3325, lng: 71.3061, pin: '364515'
  },
  {
    division: 'Amreli',
    depot: 'Rajula Bus Station',
    phones: ['02794-222070'],
    lat: 20.9992, lng: 71.4392, pin: '365560'
  },
  {
    division: 'Amreli',
    depot: 'Bagasara Bus Station',
    phones: ['02796-222061'],
    lat: 21.4883, lng: 71.0189, pin: '365440'
  },
  {
    division: 'Amreli',
    depot: 'Dhari Bus Station',
    phones: ['02797-225040'],
    lat: 21.3333, lng: 71.0167, pin: '365640'
  },
  {
    division: 'Amreli',
    depot: 'Una Bus Station',
    phones: ['02875-221600'],
    lat: 20.8247, lng: 71.0392, pin: '362560'
  },
  {
    division: 'Amreli',
    depot: 'Kodinar Bus Station',
    phones: ['02795-221398'],
    lat: 20.7917, lng: 70.7000, pin: '362720'
  },
  {
    division: 'Amreli',
    depot: 'Babra Control Point',
    phones: ['02791-233523'],
    lat: 21.8500, lng: 71.3000, pin: '365421'
  },
  {
    division: 'Amreli',
    depot: 'Lathi Control Point',
    phones: ['02793-251050'],
    lat: 21.7200, lng: 71.3900, pin: '365430'
  },
  {
    division: 'Amreli',
    depot: 'Chalala Control Point',
    phones: ['02797-251560'],
    lat: 21.4200, lng: 71.1800, pin: '365630'
  },
  {
    division: 'Amreli',
    depot: 'Damnagar Control Point',
    phones: ['02793-222225'],
    lat: 21.7000, lng: 71.5167, pin: '365220'
  },
  {
    division: 'Amreli',
    depot: 'Jafrabad Control Point',
    phones: ['02794-245100'],
    lat: 20.8667, lng: 71.3667, pin: '365540'
  }
];

export async function open() {
  let userCoords = location.get();

  const body = document.createElement('div');
  body.className = 'helpline-dir flow';
  body.style.padding = 'var(--space-3)';
  body.style.display = 'flex';
  body.style.flexDirection = 'column';
  body.style.gap = 'var(--space-2)';

  body.innerHTML = `
    <div class="card pad" style="border: 1px solid var(--line); display: flex; align-items: center; justify-content: space-between; gap: 12px; flex-wrap: wrap;">
      <div style="display: flex; align-items: center; gap: 12px; min-width: 0;">
        <span class="row-glyph" style="color: var(--brand); font-size: 20px; flex: none;">${icon('phone')}</span>
        <div style="min-width: 0;">
          <div style="font-weight: 700; font-size: calc(14.5px * var(--step));">${esc(t('centralHelpline'))}</div>
          <div style="font-size: calc(12px * var(--step)); color: var(--ink-3);">${esc(t('tollFree'))} (24x7)</div>
        </div>
      </div>
      <a href="tel:1800233666666" class="btn sm depot-call primary">
        ${icon('phone', 'i i-sm')} 1800 233 666666
      </a>
    </div>

    <div class="field" style="margin: 0;">
      <span class="lead">${icon('search')}</span>
      <input type="search" id="helpline-search" class="input" placeholder="${esc(t('searchDepot'))}" autocomplete="off" />
    </div>

    <div class="list" id="helpline-list" style="margin-top: var(--space-2);"></div>
  `;

  const getListWithDistance = () => {
    return DEPOTS.map((d) => {
      const dist = (userCoords && typeof d.lat === 'number' && typeof d.lng === 'number')
        ? haversineKm(userCoords, d)
        : null;
      return { ...d, distKm: dist };
    });
  };

  const render = (query) => {
    const list = $('#helpline-list', body);
    if (!list) return;
    const q = (query || '').toLowerCase().trim();
    
    let items = getListWithDistance();
    if (userCoords) {
      items.sort((a, b) => (a.distKm ?? 9999) - (b.distKm ?? 9999));
    }

    const filtered = items.filter((d) => {
      if (!q) return true;
      return d.depot.toLowerCase().includes(q)
        || d.division.toLowerCase().includes(q)
        || (d.pin && d.pin.includes(q))
        || d.phones.some((p) => p.replace(/\s+/g, '').includes(q.replace(/\s+/g, '')));
    });

    if (filtered.length === 0) {
      list.innerHTML = `<div class="pad-3" style="text-align: center; color: var(--ink-3);">${esc(t('noBuses'))}</div>`;
      return;
    }

    let html = '';
    for (const d of filtered) {
      const hasDistance = typeof d.distKm === 'number' && Number.isFinite(d.distKm) && d.distKm >= 0;
      const distFormatted = hasDistance ? distance(d.distKm) : '';
      
      const phoneButtons = d.phones.map((ph) => {
        const cleanTel = ph.replace(/[^0-9+]/g, '');
        return `<a href="tel:${cleanTel}" class="btn sm ghost depot-call">
          ${icon('phone', 'i i-sm')}${esc(ph)}
        </a>`;
      }).join('');

      // Name above, numbers below. Side by side, two long numbers won a fight with the depot
      // name and squeezed it to zero width — it rendered one letter per line.
      html += `
        <div class="depot-row">
          <div class="depot-head">
            <span class="row-glyph">${icon('phone')}</span>
            <span class="depot-name">
              <span class="depot-title">${esc(d.depot)}</span>
              <span class="depot-meta">
                <span>${esc(d.division)}</span>
                ${d.pin ? `<span class="depot-pin">· ${esc(t('pin'))} ${esc(d.pin)}</span>` : ''}
                ${hasDistance && distFormatted
    ? `<span class="badge live badge-distance">${icon('navigation', 'i i-sm')}${esc(distFormatted)}</span>`
    : ''}
              </span>
            </span>
          </div>
          <div class="depot-calls">${phoneButtons}</div>
        </div>
      `;
    }
    
    list.innerHTML = html;
  };

  const updateSubtitle = () => {
    const el = $('#sheet-title');
    if (el) el.innerHTML = `${esc(t('helplineDir'))}${userCoords ? `<span class="s">${esc(t('nearestDepots'))}</span>` : `<span class="s">${esc(t('helplineDirHint'))}</span>`}`;
  };

  openSheet({
    title: t('helplineDir'),
    subtitle: userCoords ? t('nearestDepots') : t('helplineDirHint'),
    body,
  });

  const input = $('#helpline-search', body);
  input?.addEventListener('input', () => render(input.value));
  render('');

  // Fetch or refresh location in background with coarse accuracy for instant response
  locate({ timeout: 8000, highAccuracy: false }).then((pos) => {
    if (pos && typeof pos.lat === 'number' && typeof pos.lng === 'number') {
      userCoords = { lat: pos.lat, lng: pos.lng };
      location.set(userCoords);
      updateSubtitle();
      render(input?.value || '');
    }
  }).catch(() => {
    // If coarse fails, try standard highAccuracy
    locate({ timeout: 10000, highAccuracy: true }).then((pos) => {
      if (pos && typeof pos.lat === 'number' && typeof pos.lng === 'number') {
        userCoords = { lat: pos.lat, lng: pos.lng };
        location.set(userCoords);
        updateSubtitle();
        render(input?.value || '');
      }
    }).catch(() => {});
  });
}
