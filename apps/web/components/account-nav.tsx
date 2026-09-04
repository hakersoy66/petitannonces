"use client";

import styles from "./account-nav.module.css";

type Active = "dashboard" | "listings" | "messages" | "notifications" | "favorites" | "orders" | "profile" | "settings";

type Props = {
  active: Active;
  mode?: "sidebar" | "bar";
  unreadMessages?: number;
  unreadNotifications?: number;
};

const items: Array<{ key: Active; href: string; label: string; short: string }> = [
  { key: "dashboard", href: "/mon-compte", label: "Vue d’ensemble", short: "Accueil" },
  { key: "listings", href: "/mon-compte/annonces", label: "Mes annonces", short: "Annonces" },
  { key: "messages", href: "/messages", label: "Messages", short: "Messages" },
  { key: "notifications", href: "/mon-compte/notifications", label: "Notifications", short: "Alertes" },
  { key: "favorites", href: "/mon-compte/favoris", label: "Favoris", short: "Favoris" },
  { key: "orders", href: "/commandes", label: "Achats & ventes", short: "Commandes" },
  { key: "profile", href: "/mon-compte/profil", label: "Profil", short: "Profil" },
  { key: "settings", href: "/mon-compte/parametres", label: "Paramètres", short: "Réglages" },
];

export function AccountNav({ active, mode = "bar", unreadMessages = 0, unreadNotifications = 0 }: Props) {
  return (
    <nav className={`${styles.nav} ${mode === "sidebar" ? styles.sidebar : styles.bar}`} aria-label="Navigation du compte">
      {items.map((item) => {
        const badge = item.key === "messages" ? unreadMessages : item.key === "notifications" ? unreadNotifications : 0;
        return (
          <a key={item.key} href={item.href} className={active === item.key ? styles.active : undefined} aria-current={active === item.key ? "page" : undefined}>
            <span className={styles.marker} aria-hidden="true" />
            <span className={styles.desktopLabel}>{item.label}</span>
            <span className={styles.mobileLabel}>{item.short}</span>
            {badge > 0 && <b>{badge > 99 ? "99+" : badge}</b>}
          </a>
        );
      })}
    </nav>
  );
}
