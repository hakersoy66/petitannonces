import { FontAwesomeIcon } from "@fortawesome/react-fontawesome";
import { config, type IconDefinition } from "@fortawesome/fontawesome-svg-core";
import {
  faArrowLeft, faArrowRight, faBell, faBolt, faBox, faBriefcase, faCalendarDays,
  faCamera, faCar, faCheck, faChevronDown, faChevronLeft, faChevronRight,
  faCircleCheck, faCircleInfo, faClock, faComments, faCreditCard, faDoorOpen,
  faEnvelope, faEye, faFutbol, faGasPump, faGaugeHigh, faGears, faHandshake,
  faHouse, faIdCard, faImage, faLaptop, faLocationDot, faLock, faMagnifyingGlass,
  faMapLocationDot, faMessage, faPalette, faPhone, faPlus, faRectangleList,
  faRulerCombined, faShareNodes, faShieldHalved, faShirt, faStar,
  faStore, faTruck, faUser, faUserShield, faWallet, faWandMagicSparkles,
  faScrewdriverWrench, faChildReaching, faCouch, faMotorcycle, faPaw, faWifi, faGripLines, faEllipsisVertical,
} from "@fortawesome/free-solid-svg-icons";
import { faHeart } from "@fortawesome/free-regular-svg-icons";

config.autoAddCss = false;

export type AppIconName =
  | "arrow-left" | "arrow-right" | "bell" | "bolt" | "box" | "briefcase" | "calendar"
  | "camera" | "car" | "check" | "chevron-down" | "chevron-left" | "chevron-right"
  | "circle-check" | "info" | "clock" | "comments" | "credit-card" | "door"
  | "envelope" | "eye" | "football" | "fuel" | "gauge" | "gears" | "handshake" | "heart"
  | "home" | "id-card" | "image" | "laptop" | "location" | "lock" | "search"
  | "map" | "message" | "palette" | "phone" | "plus" | "list" | "ruler"
  | "share" | "shield" | "shirt" | "sparkles" | "star" | "store" | "truck"
  | "user" | "user-shield" | "wallet" | "wand" | "tools" | "child" | "couch"
  | "motorcycle" | "paw" | "wifi" | "grip" | "ellipsis";

const icons: Record<AppIconName, IconDefinition> = {
  "arrow-left": faArrowLeft, "arrow-right": faArrowRight, bell: faBell, bolt: faBolt,
  box: faBox, briefcase: faBriefcase, calendar: faCalendarDays, camera: faCamera, car: faCar,
  check: faCheck, "chevron-down": faChevronDown, "chevron-left": faChevronLeft,
  "chevron-right": faChevronRight, "circle-check": faCircleCheck, info: faCircleInfo,
  clock: faClock, comments: faComments, "credit-card": faCreditCard, door: faDoorOpen,
  envelope: faEnvelope, eye: faEye, football: faFutbol, fuel: faGasPump, gauge: faGaugeHigh, gears: faGears,
  handshake: faHandshake, heart: faHeart, home: faHouse, "id-card": faIdCard, image: faImage,
  laptop: faLaptop, location: faLocationDot, lock: faLock, search: faMagnifyingGlass,
  map: faMapLocationDot, message: faMessage, palette: faPalette, phone: faPhone, plus: faPlus,
  list: faRectangleList, ruler: faRulerCombined, share: faShareNodes, shield: faShieldHalved,
  shirt: faShirt, sparkles: faWandMagicSparkles, star: faStar, store: faStore, truck: faTruck,
  user: faUser, "user-shield": faUserShield, wallet: faWallet, wand: faWandMagicSparkles,
  tools: faScrewdriverWrench, child: faChildReaching, couch: faCouch, motorcycle: faMotorcycle,
  paw: faPaw, wifi: faWifi, grip: faGripLines, ellipsis: faEllipsisVertical,
};

export function AppIcon({ name, className, title }: { name: AppIconName; className?: string; title?: string }) {
  return <FontAwesomeIcon icon={icons[name]} className={className} title={title} aria-hidden={title ? undefined : true} />;
}