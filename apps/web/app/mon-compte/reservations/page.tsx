"use client";

import { AccountSidebar } from "../../../components/account-sidebar";
import { VacationReservations } from "../../../components/vacation-reservations";
import styles from "./page.module.css";

export default function VacationReservationsAccountPage(){
 return <div className={styles.page}><main className={styles.shell}><AccountSidebar/><section className={styles.content}><VacationReservations/></section></main></div>;
}
