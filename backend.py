"""Sakhi backend functions.

Retains the existing database, vaccination, visit, dashboard, read-only
chatbot, note parsing, parameter validation, and workflow functions.
Legacy duplicate note-extraction helpers and inline test snippets are omitted.
"""

import json
import re
import sqlite3
from collections import defaultdict
from datetime import date, datetime, timedelta

import pandas as pd

def get_conn():
    conn=sqlite3.connect("asha_data.db")
    return conn

def get_keyword(in_note):
    try:
        conn = get_conn()
        kt1 = pd.read_sql_query("SELECT * FROM keyword1", conn)
        kt2 = pd.read_sql_query("SELECT * FROM keyword2", conn)
        kt3 = pd.read_sql_query("SELECT * FROM keyword3", conn)
        kt4 = pd.read_sql_query("SELECT * FROM keyword4", conn)
        
        words = re.findall(r'\b\w+\b', in_note.lower())

        keyword_tables = {
            "kt1": kt1,
            "kt2": kt2,
            "kt3": kt3,
            "kt4": kt4
        }

        matches = {
            "kt1": [],
            "kt2": [],
            "kt3": [],
            "kt4": []
        }

        for table_name, df in keyword_tables.items():
            keywords = set(
                df.astype(str)
                  .values
                  .flatten()
            )

            keywords = {word.strip().lower() for word in keywords}

            for word in words:
                if word in keywords:
                    matches[table_name].append(word)

        return matches

    except Exception as e:
        print("get_keyword:", e)
        return None
    
def get_flag(in_note):
    try:
        matches = get_keyword(in_note)
        if not matches:
            return {}

        persons = matches['kt1']
        conditions = matches['kt2']
        locations = matches['kt3']
        emergency_keys = matches['kt4']

        if not emergency_keys:
            return {}

        conn = get_conn()

        emergency_data = {}

        for key in emergency_keys:
            result = conn.execute(
                """
                SELECT flag, msg
                FROM keyword4
                WHERE UPPER(TRIM(keyword)) = UPPER(TRIM(?))
                """,
                (key,)
            ).fetchall()

            for flag, msg in result:
                person = ", ".join(persons) if persons else "Unknown"
                condition = ", ".join(conditions) if conditions else "Unknown"
                location = ", ".join(locations) if locations else "Not specified"
                message_parts = []
                if person:
                    message_parts.append(person)
                if condition:
                    message_parts.append(condition)
                if location and location != "Not specified":
                    message_parts.append(location)
                if msg:
                    message_parts.append(msg)
                emergency_message = " - ".join(message_parts)
                emergency_data[flag] = {
                    "person": person,
                    "condition": condition,
                    "location": location,
                    "msg": msg,
                    "emergency_message": emergency_message
                }

        return emergency_data

    except Exception as e:
        print("get_flag:", e)
        return {}


def get_all_records():
    conn = None

    try:
        conn = get_conn()
        today = pd.Timestamp(date.today())

        # =====================================
        # 1. FETCH ALL RECORDS
        # =====================================

        home = pd.read_sql_query(
            "SELECT * FROM home_records", conn
        )

        children = pd.read_sql_query(
            "SELECT * FROM children", conn
        )

        pregnancies = pd.read_sql_query(
            "SELECT * FROM pregnancies WHERE dd IS NULL", conn
        )

        visits = pd.read_sql_query(
            "SELECT * FROM visits", conn
        )

        metrics = {}

        metrics['total_homes'] = len(home)
        metrics['total_children'] = len(children)
        metrics['total_pregnancies'] = len(pregnancies)
        metrics['total_visits'] = len(visits)

        # =====================================
        # 2. VISIT STATUS
        # =====================================

        if 'visit_ts' in visits.columns:

            visit_ts = visits['visit_ts'].astype(str).str.strip().str.upper()

            completed_mask = (
                visits['visit_ts'].notna() &
                (~visit_ts.isin(['', 'NONE', 'NULL', 'NAN']))
            )

            pending_mask = ~completed_mask

            completed = visits[completed_mask].copy()
            pending = visits[pending_mask].copy()

        else:
            completed = visits.iloc[0:0].copy()
            pending = visits.copy()

        metrics['completed_visits'] = len(completed)
        metrics['pending_visits'] = len(pending)

        metrics['visit_completion_rate'] = (
            round(len(completed) / len(visits) * 100, 2)
            if len(visits) else 0
        )

        metrics['visit_pending_rate'] = (
            round(len(pending) / len(visits) * 100, 2)
            if len(visits) else 0
        )

        # =====================================
        # 3. VISIT DUE DATE ANALYSIS
        # =====================================

        if 'due_date' in visits.columns:

            raw_dates = visits['due_date'].astype(str).str.strip()

            due_dates = pd.to_datetime(
                raw_dates, format='%d-%m-%Y', errors='coerce'
            )

            iso_dates = pd.to_datetime(
                raw_dates, format='%Y-%m-%d', errors='coerce'
            )

            visits['due_date'] = due_dates.fillna(iso_dates)

            valid_due = visits['due_date'].notna()

            if 'visit_ts' in visits.columns:

                visit_ts = (
                    visits['visit_ts'].astype(str).str.strip().str.upper()
                )

                pending_mask = (
                    visits['visit_ts'].isna() |
                    visit_ts.isin(['', 'NONE', 'NULL', 'NAN'])
                )

            else:
                pending_mask = pd.Series(True, index=visits.index)

            overdue = visits[
                valid_due & (visits['due_date'] < today) & pending_mask
            ].copy()

            upcoming = visits[
                valid_due & (visits['due_date'] >= today) & pending_mask
            ].copy()

            due_today = visits[
                (visits['due_date'].dt.normalize() == today) & pending_mask
            ].copy()

            due_next_7_days = visits[
                (visits['due_date'] > today) &
                (visits['due_date'] <= today + pd.Timedelta(days=7)) &
                pending_mask
            ].copy()

            due_next_30_days = visits[
                (visits['due_date'] > today) &
                (visits['due_date'] <= today + pd.Timedelta(days=30)) &
                pending_mask
            ].copy()

            metrics['overdue_visits'] = len(overdue)
            metrics['upcoming_visits'] = len(upcoming)
            metrics['due_today'] = len(due_today)
            metrics['due_next_7_days'] = len(due_next_7_days)
            metrics['due_next_30_days'] = len(due_next_30_days)

            metrics['missing_due_dates'] = visits['due_date'].isna().sum()

        else:

            overdue = visits.iloc[0:0].copy()
            upcoming = visits.iloc[0:0].copy()
            due_today = visits.iloc[0:0].copy()
            due_next_7_days = visits.iloc[0:0].copy()
            due_next_30_days = visits.iloc[0:0].copy()

            metrics['overdue_visits'] = 0
            metrics['upcoming_visits'] = 0
            metrics['due_today'] = 0
            metrics['due_next_7_days'] = 0
            metrics['due_next_30_days'] = 0
            metrics['missing_due_dates'] = 0

        metrics['missing_visit_timestamps'] = len(pending)

        # =====================================
        # 4. CHILD STATISTICS
        # =====================================

        metrics['total_children'] = len(children)

        if 'gender' in children.columns:

            gender = children['gender'].astype(str).str.strip().str.upper()

            metrics['male_children'] = gender.isin(
                ['M', 'MALE']
            ).sum()

            metrics['female_children'] = gender.isin(
                ['F', 'FEMALE']
            ).sum()

        else:
            metrics['male_children'] = 0
            metrics['female_children'] = 0

        # =====================================
        # 5. VACCINATION ANALYTICS
        # =====================================

        def parse_vaccines(value):
            if isinstance(value, dict):
                return value

            if not value or str(value).strip().upper() in (
                'NONE', 'NULL', 'NAN', ''
            ):
                return {}

            try:
                result = json.loads(value)
                return result if isinstance(result, dict) else {}
            except (json.JSONDecodeError, TypeError):
                return {}

        # Parse JSON columns
        for col in ['vacs_taken', 'vacs_due', 'next_vac_n_due']:

            if col in children.columns:
                children[col] = children[col].apply(parse_vaccines)
            else:
                children[col] = [{} for _ in range(len(children))]

        # Aggregated vaccination dictionaries
        vacs_taken = {}
        vacs_due = {}
        next_vac_n_due = {}

        # Child-level vaccination datasets
        taken_records = []
        due_records = []
        upcoming_records = []

        for _, child in children.iterrows():

            ben_id = child.get('beneficiary_id')
            child_name = child.get('child_name', 'Unknown')

            # Vaccines taken
            for vaccine, administered_date in child['vacs_taken'].items():

                vacs_taken.setdefault(vaccine, []).append({
                    'beneficiary_id': ben_id,
                    'child_name': child_name,
                    'date': administered_date
                })

                taken_records.append({
                    'beneficiary_id': ben_id,
                    'child_name': child_name,
                    'vaccine': vaccine,
                    'date': administered_date
                })

            # Vaccines due
            for vaccine, due_date in child['vacs_due'].items():

                vacs_due.setdefault(vaccine, []).append({
                    'beneficiary_id': ben_id,
                    'child_name': child_name,
                    'date': due_date
                })

                due_records.append({
                    'beneficiary_id': ben_id,
                    'child_name': child_name,
                    'vaccine': vaccine,
                    'date': due_date
                })

            # Upcoming vaccines
            for vaccine, due_date in child['next_vac_n_due'].items():

                next_vac_n_due.setdefault(vaccine, []).append({
                    'beneficiary_id': ben_id,
                    'child_name': child_name,
                    'date': due_date
                })

                upcoming_records.append({
                    'beneficiary_id': ben_id,
                    'child_name': child_name,
                    'vaccine': vaccine,
                    'date': due_date
                })

        # =====================================
        # 6. MATERNAL VACCINATION ANALYTICS
        # =====================================

        mother_vacs_taken = {}
        mother_vacs_due = {}
        mother_next_vac_n_due = {}

        mother_taken_records = []
        mother_due_records = []
        mother_upcoming_records = []

        # Parse pregnancy vaccination columns
        for col in ['vacs_taken', 'vac_due', 'next_vac_n_due']:
        
            if col in pregnancies.columns:
                pregnancies[col] = pregnancies[col].apply(parse_vaccines)
            else:
                pregnancies[col] = [{} for _ in range(len(pregnancies))]


        for _, mother in pregnancies.iterrows():
        
            ben_id = mother.get('beneficiary_id')

            # Vaccines taken
            for vaccine, administered_date in mother['vacs_taken'].items():
            
                mother_vacs_taken.setdefault(vaccine, []).append({
                    'beneficiary_id': ben_id,
                    'date': administered_date
                })

                mother_taken_records.append({
                    'beneficiary_id': ben_id,
                    'vaccine': vaccine,
                    'date': administered_date
                })

            # Vaccines due
            for vaccine, due_date in mother['vac_due'].items():
            
                mother_vacs_due.setdefault(vaccine, []).append({
                    'beneficiary_id': ben_id,
                    'date': due_date
                })

                mother_due_records.append({
                    'beneficiary_id': ben_id,
                    'vaccine': vaccine,
                    'date': due_date
                })

            # Upcoming vaccines
            for vaccine, due_date in mother['next_vac_n_due'].items():
            
                mother_next_vac_n_due.setdefault(vaccine, []).append({
                    'beneficiary_id': ben_id,
                    'date': due_date
                })

                mother_upcoming_records.append({
                    'beneficiary_id': ben_id,
                    'vaccine': vaccine,
                    'date': due_date
                })


        # Convert to DataFrames
        mother_vacs_taken_df = pd.DataFrame(mother_taken_records)
        mother_vacs_due_df = pd.DataFrame(mother_due_records)
        mother_next_vac_n_due_df = pd.DataFrame(mother_upcoming_records)


        # Maternal vaccination metrics
        metrics['maternal_vaccines_taken'] = len(mother_taken_records)
        metrics['maternal_vaccines_due'] = len(mother_due_records)
        metrics['maternal_upcoming_vaccines'] = len(mother_upcoming_records)

        metrics['mothers_with_pending_vaccines'] = (
            pregnancies['vac_due'].apply(bool).sum()
        )

        metrics['mothers_with_completed_vaccines'] = (
            pregnancies['vacs_taken'].apply(bool).sum()
        )

        metrics['mothers_with_upcoming_vaccines'] = (
            pregnancies['next_vac_n_due'].apply(bool).sum()
        )
        # Vaccination DataFrames
        vacs_taken_df = pd.DataFrame(taken_records)
        vacs_due_df = pd.DataFrame(due_records)
        next_vac_n_due_df = pd.DataFrame(upcoming_records)

        # Vaccination metrics
        metrics['total_vaccines_taken'] = len(taken_records)
        metrics['total_vaccines_due'] = len(due_records)
        metrics['total_upcoming_vaccines'] = len(upcoming_records)

        metrics['children_with_pending_vaccines'] = (
            children['vacs_due'].apply(bool).sum()
        )

        metrics['children_with_completed_vaccines'] = (
            children['vacs_taken'].apply(bool).sum()
        )

        metrics['children_with_upcoming_vaccines'] = (
            children['next_vac_n_due'].apply(bool).sum()
        )

        # =====================================
        # 6. PREGNANCY STATISTICS
        # =====================================

        metrics['total_pregnancies'] = len(pregnancies)

        if 'status' in pregnancies.columns:

            status = (
                pregnancies['status'].astype(str).str.strip().str.upper()
            )

            metrics['active_pregnancies'] = status.isin(
                ['ACTIVE', 'ONGOING']
            ).sum()

            metrics['completed_pregnancies'] = status.isin(
                ['COMPLETED', 'DELIVERED']
            ).sum()

        else:
            metrics['active_pregnancies'] = 0
            metrics['completed_pregnancies'] = 0

        # =====================================
        # 7. RETURN ALL DATA
        # =====================================

        return {
            # Main datasets
            'home': home,
            'children': children,
            'pregnancies': pregnancies,
            'visits': visits,
            # Visit datasets
            'completed_visits': completed,
            'pending_visits_data': pending,
            'overdue_visits_data': overdue,
            'upcoming_visits_data': upcoming,

            # Scheduling datasets
            'due_today_data': due_today,
            'due_next_7_days_data': due_next_7_days,
            'due_next_30_days_data': due_next_30_days,

            # Vaccination dictionaries
            'vacs_taken': vacs_taken,
            'vacs_due': vacs_due,
            'next_vac_n_due': next_vac_n_due,

            # Vaccination DataFrames
            'vacs_taken_df': vacs_taken_df,
            'vacs_due_df': vacs_due_df,
            'next_vac_n_due_df': next_vac_n_due_df,

            # Metrics
            'metrics': metrics,
            # Maternal vaccination dictionaries
            'mother_vacs_taken': mother_vacs_taken,
            'mother_vacs_due': mother_vacs_due,
            'mother_next_vac_n_due': mother_next_vac_n_due,

            # Maternal vaccination DataFrames
            'mother_vacs_taken_df': mother_vacs_taken_df,
            'mother_vacs_due_df': mother_vacs_due_df,
            'mother_next_vac_n_due_df': mother_next_vac_n_due_df,
        }

    except Exception as e:
        print("get_all_records:", e)
        return None

def add_new_visits(ben_id,v_type,due_date):
    conn = None
    try:
        conn = get_conn()
        result = conn.execute("""
            SELECT id
            FROM visits
            ORDER BY CAST(SUBSTR(id, 2) AS INTEGER) DESC
            LIMIT 1
        """).fetchone()

        if result:
            last_id = result[0]
            last_num = int(last_id[1:])
            new_id = f"V{last_num + 1:03d}"
        else:
            new_id = "V001"

        conn.execute("""
            INSERT INTO visits (id, beneficiary_id, voice, note, type, due_date, visit_ts, flag)
            VALUES (?, ?, ?, ?, ?,?,?,?)
        """, (new_id, ben_id, None,None, v_type,due_date,None,None))

        conn.commit()
        print("New visit created:", new_id)
        return True

    except Exception as e:
        print("add_new_visits:", e)
        if conn:
            conn.rollback()
        return False
    
def add_new_pregnancy(beneficiary_id, week, exp_dd, dd):
    conn = None
    try:
        # Validate inputs
        values = [beneficiary_id, week, exp_dd]

        if any(v is None or str(v).strip().upper() in ('', 'NONE', 'NULL') for v in values):
            raise ValueError("All pregnancy fields are required.")

        conn = get_conn()

        conn.execute("""
            INSERT INTO pregnancies (
                beneficiary_id,
                week,
                exp_dd,
                dd,
                status
            )
            VALUES (?, ?, ?, ?, ?)
        """, (
            beneficiary_id,
            week,
            exp_dd,
            dd,
            'ACTIVE'
        ))

        conn.commit()

        print("New pregnancy record added successfully.")
        return True

    except Exception as e:
        print("add_new_pregnancy:", e)
        if conn:
            conn.rollback()

        return False
    


def register_delivery(beneficiary_id, delivery_date):
    conn = None

    try:
        # ---------------------------------
        # 1. Validate inputs
        # ---------------------------------
        if not beneficiary_id or str(beneficiary_id).strip().upper() in ("NONE", "NULL"):
            raise ValueError("Beneficiary ID is required.")

        if not delivery_date or str(delivery_date).strip().upper() in ("NONE", "NULL"):
            raise ValueError("Delivery date is required.")

        delivery_dt = datetime.strptime(delivery_date, "%d-%m-%Y")

        conn = get_conn()

        # ---------------------------------
        # 2. Retrieve active pregnancy
        # ---------------------------------
        cursor = conn.execute("""
            SELECT *
            FROM pregnancies
            WHERE beneficiary_id = ?
              AND COALESCE(UPPER(TRIM(status)), '') != 'COMPLETED'
        """, (beneficiary_id,))

        row = cursor.fetchone()

        if not row:
            print("No active pregnancy record found.")
            return False

        # Convert row to dictionary, regardless of row_factory
        columns = [column[0] for column in cursor.description]
        pregnancy = dict(zip(columns, row))

        # ---------------------------------
        # 4. Retrieve existing maternal vaccines
        # ---------------------------------
        existing_taken = pregnancy.get("vacs_taken") or {}

        if isinstance(existing_taken, str):
            existing_taken = json.loads(existing_taken)

        if not isinstance(existing_taken, dict):
            existing_taken = {}

        # Extract actual Td administration dates.
        # These must be recorded administration dates,
        # not calculated or scheduled dates.
        previous_td_dates = {}

        for vaccine, date in existing_taken.items():
            if "TD" in vaccine.upper() and date:
                previous_td_dates[vaccine] = date

        # ---------------------------------
        # 5. Calculate maternal vaccines
        # ---------------------------------
        pregnancy_week = pregnancy.get("week")

        if pregnancy_week is None:
            raise ValueError("Current pregnancy week is missing.")

        pregnancy_week = int(pregnancy_week)

        try:
            maternal_vacs = calc_vacs(
                pregnancy_week=int(pregnancy["week"]),
                delivery_date=delivery_date,
                previous_td_dates=previous_td_dates,
                administered=pregnancy.get("vacs_taken", {}),
                mode="mother"
            )

            print("MATERNAL CALCULATION OUTPUT:", repr(maternal_vacs))
            print("OUTPUT TYPE:", type(maternal_vacs))

        except Exception as e:
            print("CALC_VACS ERROR:", repr(e))
            raise
        if not isinstance(maternal_vacs, dict):
            raise ValueError("Maternal vaccination calculation failed.")

        vacs_taken = maternal_vacs.get("vacs_taken", {})
        vacs_due = maternal_vacs.get("vacs_due", {})
        next_vac_n_due = maternal_vacs.get("next_vac_n_due", {})

        # ---------------------------------
        # 6. Collect newborn details
        # ---------------------------------
        child_name = input("Enter child name: ").strip()
        gender = input("Enter gender (M/F): ").strip().upper()

        try:
            weight = float(input("Enter birth weight (kg): "))
        except ValueError:
            raise ValueError("Invalid birth weight.")

        if not child_name:
            raise ValueError("Child name is required.")

        if gender not in ("M", "F"):
            raise ValueError("Gender must be M or F.")

        if weight <= 0:
            raise ValueError("Birth weight must be greater than zero.")

        # Do not assume any newborn vaccines were administered.
        child_vacs_taken = {}

        next_visit = input(
            "Enter next visit date (DD-MM-YYYY): "
        ).strip()

        datetime.strptime(next_visit, "%d-%m-%Y")

        # ---------------------------------
        # 7. Register newborn
        # ---------------------------------
        child_added = add_child(
            beneficiary_id,
            child_name,
            gender,
            delivery_date,
            weight,
            child_vacs_taken,
            next_visit
        )

        if not child_added:
            raise ValueError("Child registration failed.")

        # ---------------------------------
        # 8. Update pregnancy and maternal vaccines
        # ---------------------------------
        conn.execute("""
            UPDATE pregnancies
            SET dd = ?,
                status = 'COMPLETED',
                vacs_taken = ?,
                vac_due = ?,
                next_vac_n_due = ?
            WHERE beneficiary_id = ?
              AND COALESCE(UPPER(TRIM(status)), '') != 'COMPLETED'
        """, (
            delivery_date,
            json.dumps(vacs_taken),
            json.dumps(vacs_due),
            json.dumps(next_vac_n_due),
            beneficiary_id
        ))

        conn.commit()

        print("\nDelivery and newborn registration successful.")
        print("Maternal vaccination schedule updated.")

        print("\nMaternal Vaccination Summary")
        print("Vaccines taken:", vacs_taken)
        print("Vaccines overdue:", vacs_due)
        print("Next vaccine due:", next_vac_n_due)

        return True

    except Exception as e:
        print("register_delivery:", e)

        if conn:
            conn.rollback()

        return False



def parse_date(value):
    """Convert supported date formats into datetime.date."""
    if isinstance(value, datetime):
        return value.date()

    if isinstance(value, date):
        return value

    if not value:
        return None

    for fmt in ("%d-%m-%Y", "%Y-%m-%d"):
        try:
            return datetime.strptime(str(value).strip(), fmt).date()
        except ValueError:
            continue

    raise ValueError(f"Invalid date format: {value}")


def calc_vacs(
    dob=None,
    administered=None,
    json_file="vacs.json",
    mode="child",
    pregnancy_week=None,
    delivery_date=None,
    previous_td_dates=None
):
    """
    Calculate child or maternal vaccination status.

    mode:
        child  = Calculate using date of birth.
        mother = Calculate using current pregnancy week.

    administered:
        Dictionary of actual administered vaccine dates.

    previous_td_dates:
        List of historical Td/TT administration dates.
    """

    today = date.today()

    # -----------------------------------------
    # 1. Normalize administered records
    # -----------------------------------------
    if isinstance(administered, str):
        administered = json.loads(administered)

    administered = administered or {}

    if not isinstance(administered, dict):
        raise ValueError("Administered vaccines must be a dictionary.")

    taken = {}

    for vaccine, administered_date in administered.items():
        if administered_date:
            parsed_date = parse_date(administered_date)

            if not parsed_date:
                raise ValueError(
                    f"Invalid administration date for {vaccine}"
                )

            # Keep dates in DD-MM-YYYY format in output.
            taken[vaccine.strip()] = parsed_date.strftime("%d-%m-%Y")

    if isinstance(previous_td_dates, dict):
        previous_td_dates = list(previous_td_dates.values())

    previous_td_dates = previous_td_dates or []

    # -----------------------------------------
    # 2. Load vaccination schedule
    # -----------------------------------------
    with open(json_file, "r", encoding="utf-8") as file:
        schedule = json.load(file)

    vacs_due = {}
    next_vac_n_due = {}

    # =========================================
    # CHILD VACCINATION CALCULATION
    # =========================================
    if mode.lower() == "child":

        if not dob:
            raise ValueError("Date of birth is required for child mode.")

        birth_date = parse_date(dob)

        if not birth_date:
            raise ValueError("Invalid child date of birth.")

        if birth_date > today:
            raise ValueError("Date of birth cannot be in the future.")

        child_schedule = schedule.get("children", {})
        scheduled_vaccines = []

        for age_group, vaccine_list in child_schedule.items():

            match = re.search(r"\d+", age_group)

            if not match:
                continue

            weeks = int(match.group())

            scheduled_date = birth_date + timedelta(weeks=weeks)

            vaccines = [
                vaccine.strip()
                for vaccine in vaccine_list.split(",")
                if vaccine.strip()
            ]

            for vaccine in vaccines:

                if vaccine in taken:
                    continue

                scheduled_vaccines.append(
                    (scheduled_date, vaccine)
                )

        scheduled_vaccines.sort(key=lambda item: item[0])

        upcoming_dates = []

        for scheduled_date, vaccine in scheduled_vaccines:

            date_string = scheduled_date.strftime("%d-%m-%Y")

            if scheduled_date <= today:
                vacs_due[vaccine] = date_string
            else:
                upcoming_dates.append(
                    (scheduled_date, vaccine)
                )

        if upcoming_dates:

            immediate_date = upcoming_dates[0][0]

            for scheduled_date, vaccine in upcoming_dates:

                if scheduled_date == immediate_date:
                    next_vac_n_due[vaccine] = (
                        scheduled_date.strftime("%d-%m-%Y")
                    )

    # =========================================
    # MATERNAL VACCINATION CALCULATION
    # =========================================
    elif mode.lower() == "mother":

        # 1. Validate pregnancy week
        if pregnancy_week is None:
            raise ValueError("Current pregnancy week is required.")

        pregnancy_week = int(pregnancy_week)

        if not 0 <= pregnancy_week <= 42:
            raise ValueError("Invalid pregnancy week. Expected 0-42.")

        # 2. Historical Td/TT dates
        historical_dates = []

        for d in previous_td_dates:
            if d:
                parsed = parse_date(d)
                if parsed:
                    historical_dates.append(parsed)

        # Include actual current pregnancy Td/TT records.
        for vaccine, administered_date in taken.items():

            if vaccine.upper().startswith(("TD", "TT")):
                parsed = parse_date(administered_date)

                if parsed:
                    historical_dates.append(parsed)

        historical_dates = sorted(set(historical_dates))

        # 3. Booster eligibility
        booster_eligible = False

        for i in range(len(historical_dates)):
            for j in range(i + 1, len(historical_dates)):

                difference = (
                    historical_dates[j] - historical_dates[i]
                ).days

                if difference <= 156 * 7:
                    booster_eligible = True
                    break

            if booster_eligible:
                break

        # 4. Prepare maternal schedule
        scheduled_vaccines = []

        def add_maternal_vaccine(vaccine, scheduled_date):

            if vaccine not in taken and scheduled_date:
                scheduled_vaccines.append(
                    (scheduled_date, vaccine)
                )

        td1_date = taken.get("Td-1")

        # 5. Determine antenatal vaccine
        if booster_eligible:

            if pregnancy_week <= 36:
                add_maternal_vaccine("Td Booster", today)

        else:

            if not td1_date:

                if pregnancy_week <= 12:
                    add_maternal_vaccine("Td-1", today)

            else:

                td1_dt = parse_date(td1_date)

                if not td1_dt:
                    raise ValueError("Invalid Td-1 administration date.")

                td2_date = td1_dt + timedelta(weeks=4)

                if pregnancy_week <= 36:
                    add_maternal_vaccine("Td-2", td2_date)

        # 6. Delivery catch-up
        delivery = (
            parse_date(delivery_date)
            if delivery_date
            else None
        )

        has_any_td = (
            bool(historical_dates)
            or any(
                vaccine.upper().startswith(("TD", "TT"))
                for vaccine in taken
            )
        )

        if delivery and not has_any_td:

            add_maternal_vaccine(
                "Td (Emergency catch-up)",
                delivery
            )

        # 7. Stop antenatal scheduling after delivery
        if delivery:
            scheduled_vaccines = [
                item for item in scheduled_vaccines
                if item[1] == "Td (Emergency catch-up)"
            ]

        # 8. Determine due and upcoming vaccines
        scheduled_vaccines.sort(key=lambda item: item[0])

        upcoming_dates = []

        for scheduled_date, vaccine in scheduled_vaccines:

            date_string = scheduled_date.strftime("%d-%m-%Y")

            if scheduled_date <= today:
                vacs_due[vaccine] = date_string

            else:
                upcoming_dates.append(
                    (scheduled_date, vaccine)
                )

        # 9. Only earliest upcoming vaccine
        if upcoming_dates:

            immediate_date = upcoming_dates[0][0]

            for scheduled_date, vaccine in upcoming_dates:

                if scheduled_date == immediate_date:
                    next_vac_n_due[vaccine] = (
                        scheduled_date.strftime("%d-%m-%Y")
                    )

    else:
        raise ValueError(
            "mode must be either 'child' or 'mother'."
        )

    # =========================================
    # COMMON RETURN FOR BOTH MODES
    # =========================================
    return {
        "vacs_taken": taken,
        "vacs_due": vacs_due,
        "next_vac_n_due": next_vac_n_due
    }


def add_child(beneficiary_id, child_name, gender, dob, weight,vacs_taken, next_visit):
    conn = None
    try:
        # Validate required fields
        values = [
            beneficiary_id, child_name, gender,
            dob, weight, next_visit
        ]

        if any(
            v is None or str(v).strip().upper() in ('', 'NONE', 'NULL')
            for v in values
        ):
            raise ValueError("All child details are required.")

        # Validate DOB
        dob_date = datetime.strptime(dob, "%d-%m-%Y").date()

        if dob_date > date.today():
            raise ValueError("DOB cannot be in the future.")

        # Calculate age
        today = date.today()

        age = (
            today.year - dob_date.year -
            ((today.month, today.day) < (dob_date.month, dob_date.day))
        )

        # Calculate vaccinations
        vac_res = calc_vacs(
            dob,
            administered=vacs_taken,
            json_file="vacs.json"
        )

        if vac_res is None:
            raise ValueError("Vaccination calculation failed.")

        # Convert dictionaries into JSON strings
        taken_json = json.dumps(vac_res["vacs_taken"])
        due_json = json.dumps(vac_res["vacs_due"])
        next_json = json.dumps(vac_res["next_vac_n_due"])

        # Database insertion
        conn = get_conn()

        conn.execute("""
            INSERT INTO children (
                beneficiary_id,
                child_name,
                dob,
                age,
                gender,
                weight,
                vacs_taken,
                vacs_due,
                next_vac_n_due,
                next_visit
            )
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        """, (
            beneficiary_id,
            child_name,
            dob,
            age,
            gender,
            weight,
            taken_json,
            due_json,
            next_json,
            next_visit
        ))

        conn.commit()

        print("Child registered successfully.")
        return True

    except Exception as e:
        print("add_child:", e)

        if conn:
            conn.rollback()

        return False

def update_visit(visit_id, beneficiary_id, voice, note, visit_type):
    conn = None

    try:
        # Validate inputs
        values = [visit_id, beneficiary_id, voice, note, visit_type]

        if any(v is None or str(v).strip().upper() in ("", "NONE", "NULL")
               for v in values):
            raise ValueError("All visit details are required.")

        # Generate flag using existing flagging function
        flag_result = get_flag(note)

        # Extract flag names
        if isinstance(flag_result, dict):
            flags = list(flag_result.keys())
        else:
            flags = []

        flag = ", ".join(str(f) for f in flags) if flags else "NONE"

        # Determine next visit interval based on flag
        # Customize these intervals according to your flag definitions.
        flag_intervals = {
            "S": 0,
            "HS": 1,
            "H": 2,
            "HM": 3,
            "M": 5,
            "LM":7,
            "L":15,
            "N":30
        }

        # Use the shortest interval if multiple flags exist.
        intervals = [
            flag_intervals.get(str(f).strip().upper(), 7)
            for f in flags
        ]

        next_interval = min(intervals) if intervals else 30

        next_visit_date = date.today() + timedelta(days=next_interval)

        # Current visit timestamp
        visit_ts = datetime.now().strftime("%d-%m-%Y %H:%M:%S")

        conn = get_conn()

        # Verify visit exists and belongs to beneficiary
        existing = conn.execute("""
            SELECT id
            FROM visits
            WHERE id = ? AND beneficiary_id = ?
        """, (visit_id, beneficiary_id)).fetchone()

        if not existing:
            raise ValueError("Visit record not found for this beneficiary.")

        # Update completed visit
        conn.execute("""
            UPDATE visits
            SET
                voice = ?,
                note = ?,
                type = ?,
                visit_ts = ?,
                flag = ?,
                due_date = ?
            WHERE id = ?
            AND beneficiary_id = ?
        """, (
            voice,
            note,
            visit_type,
            visit_ts,
            flag,
            next_visit_date.strftime("%d-%m-%Y"),
            visit_id,
            beneficiary_id
        ))

        conn.commit()

        return {
            "res": True,
            "visit_id": visit_id,
            "flag": flag,
            "visit_ts": visit_ts,
            "next_visit_date": next_visit_date.strftime("%d-%m-%Y"),
            "next_visit_interval": next_interval,
            "flag_details": flag_result
        }

    except Exception as e:
        if conn:
            conn.rollback()

        return {
            "res": False,
            "error": str(e),
            "next_visit_date": None
        }
    



def normalize_text(text):
    """Normalize user input and database keywords."""
    text = str(text).upper().strip()
    text = re.sub(r"[^A-Z0-9\s]", " ", text)
    text = re.sub(r"\s+", " ", text).strip()
    return text


def phrase_match(text, phrase):
    """Match a complete phrase, avoiding partial-word matches."""
    text = normalize_text(text)
    phrase = normalize_text(phrase)

    if not phrase:
        return False

    return re.search(
        r"(?<![A-Z0-9])" + re.escape(phrase) + r"(?![A-Z0-9])",
        text
    ) is not None


def get_bot_intents(conn):
    return conn.execute("""
        SELECT intent_code, function_name, enabled
        FROM bot_intents
        WHERE enabled = 1
    """).fetchall()


def get_intent_match(query, conn):
    """Identify the most likely chatbot intent."""

    query = normalize_text(query)

    keywords = conn.execute("""
        SELECT keyword, intent_code, weight
        FROM bot_keywords
    """).fetchall()

    scores = defaultdict(int)
    matched = defaultdict(list)

    for keyword, intent_code, weight in keywords:

        if phrase_match(query, keyword):
            # Longer phrases receive a small preference.
            score = int(weight) * 10 + len(normalize_text(keyword))

            scores[intent_code] += score
            matched[intent_code].append(keyword)

    if not scores:
        return None, []

    best_intent = max(
        scores,
        key=lambda key: scores[key]
    )

    return best_intent, matched[best_intent]


def get_metric_match(query, conn):
    """Identify the best matching metric."""

    query = normalize_text(query)

    aliases = conn.execute("""
        SELECT alias, metric_key, display_name, weight
        FROM bot_metric_aliases
    """).fetchall()

    matches = []

    for alias, metric_key, display_name, weight in aliases:

        if phrase_match(query, alias):

            score = (
                int(weight) * 10
                + len(normalize_text(alias))
            )

            matches.append({
                "alias": alias,
                "metric_key": metric_key,
                "display_name": display_name,
                "score": score
            })

    if not matches:
        return None

    # Prefer the strongest and most specific match.
    matches.sort(
        key=lambda item: item["score"],
        reverse=True
    )

    return matches[0]


def show_metric(query, data, metric_match):
    """Retrieve one metric from get_all_records()."""

    metrics = data.get("metrics", {})
    key = metric_match["metric_key"]

    if key not in metrics:
        return {
            "success": False,
            "message": f"Metric '{key}' is not available in the dashboard."
        }

    value = metrics[key]

    return {
        "success": True,
        "intent": "SHOW_METRIC",
        "metric": key,
        "display_name": metric_match["display_name"],
        "value": value,
        "message": f"{metric_match['display_name']}: {value}"
    }


def show_all_metrics(data):
    """Return all available dashboard metrics."""

    metrics = data.get("metrics", {})

    if not metrics:
        return {
            "success": False,
            "message": "No dashboard metrics are currently available."
        }

    return {
        "success": True,
        "intent": "SHOW_ALL_METRICS",
        "metrics": metrics,
        "message": "\n".join(
            f"{key.replace('_', ' ').title()}: {value}"
            for key, value in metrics.items()
        )
    }


def show_help():
    return {
        "success": True,
        "intent": "HELP",
        "message": (
            "You can ask me about homes, children, pregnant women, "
            "visits, overdue visits, completed visits and vaccinations."
        )
    }

def setup_bot_tables():
    """
    Creates and populates Sakhi's read-only chatbot configuration.

    Safe to run repeatedly:
    - Existing configuration is preserved.
    - Duplicate intents, keywords and aliases are ignored.
    - No beneficiary data is modified.
    """

    conn = None

    try:
        conn = get_conn()
        cursor = conn.cursor()

        # ----------------------------------------
        # 1. CREATE TABLES
        # ----------------------------------------

        cursor.executescript("""
            CREATE TABLE IF NOT EXISTS bot_intents (
                intent_id INTEGER PRIMARY KEY AUTOINCREMENT,
                intent_code TEXT NOT NULL UNIQUE,
                description TEXT,
                function_name TEXT NOT NULL,
                enabled INTEGER NOT NULL DEFAULT 1
                    CHECK (enabled IN (0, 1))
            );

            CREATE TABLE IF NOT EXISTS bot_keywords (
                keyword_id INTEGER PRIMARY KEY AUTOINCREMENT,
                keyword TEXT NOT NULL,
                intent_code TEXT NOT NULL,
                weight INTEGER NOT NULL DEFAULT 1,
                FOREIGN KEY (intent_code)
                    REFERENCES bot_intents(intent_code)
                    ON DELETE CASCADE,
                UNIQUE(keyword, intent_code)
            );

            CREATE TABLE IF NOT EXISTS bot_metric_aliases (
                alias_id INTEGER PRIMARY KEY AUTOINCREMENT,
                alias TEXT NOT NULL UNIQUE,
                metric_key TEXT NOT NULL,
                display_name TEXT NOT NULL,
                weight INTEGER NOT NULL DEFAULT 1
            );

            CREATE INDEX IF NOT EXISTS idx_bot_keywords_intent
            ON bot_keywords(intent_code);

            CREATE INDEX IF NOT EXISTS idx_bot_keywords_keyword
            ON bot_keywords(keyword);

            CREATE INDEX IF NOT EXISTS idx_bot_metric_aliases_key
            ON bot_metric_aliases(metric_key);
        """)

        # ----------------------------------------
        # 2. REGISTER INTENTS
        # ----------------------------------------

        intents = [
            (
                "BENEFICIARY_HISTORY",
                "Fetch household profile, children, pregnancies and visit history",
                "get_beneficiary_history_df"
            ),
            (
                "MOTHER_PROFILE",
                "Fetch an individual mother's pregnancy profile",
                "get_mother_profile"
            ),
            (
                "CHILD_PROFILE",
                "Fetch an individual child's profile",
                "get_child_profile"
            ),
            (
                "ASHA_PROFILE",
                "Fetch ASHA worker profile",
                "get_asha_worker_profile"
            ),
            (
                "MOTHER_LIST",
                "Fetch the list of registered mothers",
                "get_all_mother_list"
            ),
            (
                "CHILD_LIST",
                "Fetch the list of registered children",
                "get_all_children_list"
            ),
            (
                "SHOW_ALL_METRICS",
                "Fetch all dashboard metrics",
                "get_all_records"
            ),
            (
                "SHOW_METRIC",
                "Fetch one specific dashboard metric",
                "get_all_records"
            )
        ]

        cursor.executemany("""
            INSERT OR IGNORE INTO bot_intents
            (intent_code, description, function_name)
            VALUES (?, ?, ?)
        """, intents)

        # ----------------------------------------
        # 3. REGISTER KEYWORDS
        # ----------------------------------------

        keywords = {

            "BENEFICIARY_HISTORY": [
                ("beneficiary history", 10),
                ("household history", 10),
                ("family history", 9),
                ("visit history", 9),
                ("beneficiary details", 8),
                ("household details", 8),
                ("family details", 8),
                ("home details", 7),
                ("show beneficiary", 7),
                ("beneficiary records", 8),
                ("visit records", 7),
                ("household records", 7),
                ("visits of", 8),
                ("history of", 6)
            ],

            "MOTHER_PROFILE": [
                ("mother profile", 10),
                ("pregnancy profile", 10),
                ("mother details", 9),
                ("pregnancy details", 9),
                ("pregnant woman details", 9),
                ("show mother", 8),
                ("mother information", 8),
                ("pregnancy information", 8),
                ("maternal profile", 9),
                ("mother record", 8)
            ],

            "CHILD_PROFILE": [
                ("child profile", 10),
                ("child details", 9),
                ("baby profile", 9),
                ("baby details", 9),
                ("child information", 8),
                ("show child", 8),
                ("child record", 8),
                ("infant details", 8),
                ("newborn details", 8),
                ("profile of child", 9)
            ],

            "ASHA_PROFILE": [
                ("asha profile", 10),
                ("asha worker profile", 10),
                ("asha details", 9),
                ("worker details", 8),
                ("worker profile", 9),
                ("asha information", 8),
                ("show asha", 8),
                ("staff profile", 7)
            ],

            "MOTHER_LIST": [
                ("mother list", 10),
                ("list of mothers", 10),
                ("all mothers", 9),
                ("registered mothers", 9),
                ("pregnant women list", 10),
                ("list of pregnant women", 10),
                ("show mothers", 8),
                ("mother names", 8)
            ],

            "CHILD_LIST": [
                ("child list", 10),
                ("list of children", 10),
                ("all children", 9),
                ("registered children", 9),
                ("children list", 10),
                ("show children", 8),
                ("child names", 8),
                ("baby list", 8)
            ],

            "SHOW_ALL_METRICS": [
                ("all metrics", 10),
                ("all statistics", 10),
                ("dashboard metrics", 10),
                ("overall statistics", 9),
                ("overall summary", 9),
                ("dashboard summary", 9),
                ("system overview", 8),
                ("complete summary", 8),
                ("show everything", 7),
                ("overall report", 8)
            ],

            "SHOW_METRIC": [
                ("how many", 5),
                ("total number of", 6),
                ("number of", 5),
                ("count of", 6),
                ("statistics of", 6),
                ("rate of", 5),
                ("percentage of", 6),
                ("how much", 5),
                ("total", 3)
            ]
        }

        keyword_rows = []

        for intent_code, entries in keywords.items():
            for keyword, weight in entries:
                keyword_rows.append(
                    (keyword, intent_code, weight)
                )

        cursor.executemany("""
            INSERT OR IGNORE INTO bot_keywords
            (keyword, intent_code, weight)
            VALUES (?, ?, ?)
        """, keyword_rows)

        # ----------------------------------------
        # 4. REGISTER METRIC ALIASES
        # ----------------------------------------
        #
        # These metric keys must match the keys
        # returned by get_all_records()['metrics'].
        # ----------------------------------------

        metric_aliases = [

            # Household
            ("total homes", "total_homes", "Total households", 10),
            ("total households", "total_homes", "Total households", 10),
            ("registered homes", "total_homes", "Total households", 8),
            ("registered households", "total_homes", "Total households", 9),

            # Children
            ("total children", "total_children", "Total children", 10),
            ("number of children", "total_children", "Total children", 9),
            ("registered children", "total_children", "Total children", 9),
            ("male children", "male_children", "Male children", 9),
            ("boys", "male_children", "Male children", 7),
            ("female children", "female_children", "Female children", 9),
            ("girls", "female_children", "Female children", 7),

            # Pregnancies
            ("total pregnancies", "total_pregnancies", "Total pregnancies", 10),
            ("active pregnancies", "active_pregnancies", "Active pregnancies", 10),
            ("ongoing pregnancies", "active_pregnancies", "Active pregnancies", 9),
            ("completed pregnancies", "completed_pregnancies", "Completed pregnancies", 10),
            ("delivered pregnancies", "completed_pregnancies", "Completed pregnancies", 8),

            # Visits
            ("total visits", "total_visits", "Total visits", 10),
            ("completed visits", "completed_visits", "Completed visits", 10),
            ("pending visits", "pending_visits", "Pending visits", 10),
            ("overdue visits", "overdue_visits", "Overdue visits", 10),
            ("upcoming visits", "upcoming_visits", "Upcoming visits", 10),
            ("visits due today", "due_today", "Visits due today", 10),
            ("due today", "due_today", "Visits due today", 9),
            ("visits due in 7 days", "due_next_7_days", "Visits due in next 7 days", 10),
            ("due next 7 days", "due_next_7_days", "Visits due in next 7 days", 9),
            ("visits due in 30 days", "due_next_30_days", "Visits due in next 30 days", 10),
            ("due next 30 days", "due_next_30_days", "Visits due in next 30 days", 9),
            ("visit completion rate", "visit_completion_rate", "Visit completion rate", 10),
            ("visit pending rate", "visit_pending_rate", "Visit pending rate", 10),
            ("missing due dates", "missing_due_dates", "Visits missing due dates", 9),
            ("missing visit timestamps", "missing_visit_timestamps", "Visits missing timestamps", 9),

            # Child vaccinations
            ("vaccines taken", "total_vaccines_taken", "Child vaccines administered", 9),
            ("child vaccines taken", "total_vaccines_taken", "Child vaccines administered", 10),
            ("vaccines administered", "total_vaccines_taken", "Child vaccines administered", 9),
            ("vaccines due", "total_vaccines_due", "Child vaccines due", 9),
            ("child vaccines due", "total_vaccines_due", "Child vaccines due", 10),
            ("upcoming vaccines", "total_upcoming_vaccines", "Upcoming child vaccines", 9),
            ("children with pending vaccines", "children_with_pending_vaccines", "Children with pending vaccines", 10),
            ("children with completed vaccines", "children_with_completed_vaccines", "Children with completed vaccines", 10),
            ("children with upcoming vaccines", "children_with_upcoming_vaccines", "Children with upcoming vaccines", 10),

            # Maternal vaccinations
            ("maternal vaccines taken", "maternal_vaccines_taken", "Maternal vaccines administered", 10),
            ("mother vaccines taken", "maternal_vaccines_taken", "Maternal vaccines administered", 9),
            ("maternal vaccines due", "maternal_vaccines_due", "Maternal vaccines due", 10),
            ("mother vaccines due", "maternal_vaccines_due", "Maternal vaccines due", 9),
            ("maternal upcoming vaccines", "maternal_upcoming_vaccines", "Upcoming maternal vaccines", 10),
            ("mothers with pending vaccines", "mothers_with_pending_vaccines", "Mothers with pending vaccines", 10),
            ("mothers with completed vaccines", "mothers_with_completed_vaccines", "Mothers with completed vaccines", 10),
            ("mothers with upcoming vaccines", "mothers_with_upcoming_vaccines", "Mothers with upcoming vaccines", 10)
        ]

        cursor.executemany("""
            INSERT OR IGNORE INTO bot_metric_aliases
            (alias, metric_key, display_name, weight)
            VALUES (?, ?, ?, ?)
        """, metric_aliases)

        conn.commit()

        return {
            "success": True,
            "intents_added_or_existing": len(intents),
            "keywords_added_or_existing": len(keyword_rows),
            "metric_aliases_added_or_existing": len(metric_aliases),
            "message": "Sakhi bot tables are ready."
        }

    except Exception as e:
        if conn:
            conn.rollback()

        print("setup_bot_tables:", e)

        return {
            "success": False,
            "message": str(e)
        }

setup_bot_tables()

def get_bot_function_registry():

    return {
        "get_beneficiary_history_df": get_beneficiary_history_df,
        "get_asha_worker_profile": get_asha_worker_profile,
        "get_mother_profile": get_mother_profile,
        "get_child_profile": get_child_profile,
        "get_all_mother_list": get_all_mother_list,
        "get_all_children_list": get_all_children_list,
        "get_all_records": get_all_records
    }



def handle_asha_query(query):
    """
    Sakhi read-only chatbot dispatcher.

    Supported requests:
        - Beneficiary history
        - Mother profile
        - Child profile
        - ASHA worker profile
        - Mother list
        - Child list
        - All dashboard metrics
        - Individual dashboard metric

    This function NEVER performs database writes.
    """

    conn = None

    try:

        # =========================================
        # 1. VALIDATE QUERY
        # =========================================

        if not query or not str(query).strip():

            return {
                "success": False,
                "intent": None,
                "data": None,
                "message": "Please enter a question."
            }

        original_query = str(query).strip()
        normalized = original_query.lower()

        normalized = re.sub(
            r"[^\w\s/-]",
            " ",
            normalized
        )

        normalized = re.sub(r"\s+", " ", normalized).strip()

        # =========================================
        # 2. LOAD ENABLED BOT INTENTS AND KEYWORDS
        # =========================================

        conn = get_conn()

        intents_df = pd.read_sql_query("""
            SELECT
                intent_code,
                description,
                function_name
            FROM bot_intents
            WHERE enabled = 1
        """, conn)

        keywords_df = pd.read_sql_query("""
            SELECT
                keyword,
                intent_code,
                weight
            FROM bot_keywords
        """, conn)

        aliases_df = pd.read_sql_query("""
            SELECT
                alias,
                metric_key,
                display_name,
                weight
            FROM bot_metric_aliases
        """, conn)

        conn.close()
        conn = None

        if intents_df.empty:

            return {
                "success": False,
                "intent": None,
                "data": None,
                "message": "No enabled chatbot intents found. Run setup_bot_tables()."
            }

        # =========================================
        # 3. LOAD APPROVED FUNCTION REGISTRY
        # =========================================

        registry = get_bot_function_registry()

        # =========================================
        # 4. EXTRACT BENEFICIARY ID
        # =========================================

        beneficiary_id = None

        ben_match = re.search(
            r"\b(?:BENEFICIARY|BEN|B)[\s_-]*(\d+)\b",
            normalized,
            re.IGNORECASE
        )

        if ben_match:

            beneficiary_id = "B" + ben_match.group(1)

        # =========================================
        # 5. EXTRACT ASHA WORKER ID
        # =========================================

        worker_id = None

        worker_match = re.search(
            r"\b(?:ASHA|WORKER|W)[\s_-]*(\d+)\b",
            normalized,
            re.IGNORECASE
        )

        if worker_match:

            worker_id = "ASHA" + worker_match.group(1)

        # =========================================
        # 6. EXTRACT DATE FILTERS
        # =========================================

        date_matches = re.findall(
            r"\b\d{2}-\d{2}-\d{4}\b",
            original_query
        )

        start_date = None
        end_date = None

        if len(date_matches) >= 2:

            start_date = date_matches[0]
            end_date = date_matches[1]

        elif len(date_matches) == 1:

            if any(term in normalized for term in [
                "after", "from", "since"
            ]):

                start_date = date_matches[0]

            elif any(term in normalized for term in [
                "before", "until", "till"
            ]):

                end_date = date_matches[0]

        # =========================================
        # 7. EXTRACT HOUSEHOLD STATUS
        # =========================================

        status = None

        status_values = [
            "active",
            "inactive",
            "closed",
            "open"
        ]

        for value in status_values:

            if re.search(
                rf"\b{value}\b",
                normalized
            ):

                status = value.upper()
                break

        # =========================================
        # 8. FIND METRIC ALIAS
        # =========================================

        matched_metric = None

        if not aliases_df.empty:

            metric_matches = []

            for _, alias_row in aliases_df.iterrows():

                alias = str(alias_row["alias"]).lower().strip()

                if not alias:
                    continue

                if re.search(
                    r"(?<!\w)" + re.escape(alias) + r"(?!\w)",
                    normalized
                ):

                    metric_matches.append({
                        "alias": alias,
                        "metric_key": alias_row["metric_key"],
                        "display_name": alias_row["display_name"],
                        "weight": int(alias_row["weight"])
                    })

            if metric_matches:

                # Prefer the longest matching alias.
                # Weight breaks ties.
                metric_matches.sort(
                    key=lambda x: (
                        len(x["alias"]),
                        x["weight"]
                    ),
                    reverse=True
                )

                matched_metric = metric_matches[0]

        # =========================================
        # 9. SCORE INTENTS USING KEYWORDS
        # =========================================

        scores = {}

        for intent_code in intents_df["intent_code"]:

            scores[intent_code] = 0

        for _, keyword_row in keywords_df.iterrows():

            keyword = str(
                keyword_row["keyword"]
            ).lower().strip()

            intent_code = keyword_row["intent_code"]

            weight = int(keyword_row["weight"])

            if not keyword:
                continue

            if intent_code not in scores:
                continue

            if re.search(
                r"(?<!\w)" + re.escape(keyword) + r"(?!\w)",
                normalized
            ):

                scores[intent_code] += weight

        # =========================================
        # 10. PRIORITIZE SPECIFIC INTENTS
        # =========================================

        # A matching metric alias plus a count/
        # statistics question should resolve to
        # SHOW_METRIC, not a generic profile intent.

        metric_question = any(term in normalized for term in [
            "how many",
            "how much",
            "total",
            "number of",
            "count of",
            "percentage",
            "rate of",
            "statistics of"
        ])

        if matched_metric and metric_question:

            intent_code = "SHOW_METRIC"

        else:

            # Explicit list requests get priority.
            if any(term in normalized for term in [
                "mother list",
                "list of mothers",
                "all mothers",
                "pregnant women list",
                "list of pregnant women"
            ]):

                intent_code = "MOTHER_LIST"

            elif any(term in normalized for term in [
                "child list",
                "list of children",
                "all children",
                "registered children",
                "children list"
            ]):

                intent_code = "CHILD_LIST"

            elif any(term in normalized for term in [
                "all metrics",
                "all statistics",
                "dashboard metrics",
                "overall statistics",
                "overall summary",
                "dashboard summary",
                "system overview",
                "complete summary"
            ]):

                intent_code = "SHOW_ALL_METRICS"

            else:

                # Pick the highest scoring enabled intent.
                available_codes = set(
                    intents_df["intent_code"].tolist()
                )

                scores = {
                    key: value
                    for key, value in scores.items()
                    if key in available_codes
                }

                if not scores or max(scores.values()) == 0:

                    return {
                        "success": False,
                        "intent": None,
                        "data": None,
                        "message": (
                            "I could not identify your request. "
                            "Try asking for a beneficiary history, "
                            "mother profile, child profile, ASHA profile, "
                            "mother list, child list or dashboard metric."
                        )
                    }

                # Deterministic tie-breaking.
                priority = [
                    "MOTHER_PROFILE",
                    "CHILD_PROFILE",
                    "ASHA_PROFILE",
                    "BENEFICIARY_HISTORY",
                    "MOTHER_LIST",
                    "CHILD_LIST",
                    "SHOW_ALL_METRICS",
                    "SHOW_METRIC"
                ]

                intent_code = sorted(
                    scores,
                    key=lambda code: (
                        scores[code],
                        -priority.index(code)
                        if code in priority else -999
                    ),
                    reverse=True
                )[0]

        # =========================================
        # 11. LOAD INTENT CONFIGURATION
        # =========================================

        intent_rows = intents_df[
            intents_df["intent_code"] == intent_code
        ]

        if intent_rows.empty:

            return {
                "success": False,
                "intent": intent_code,
                "data": None,
                "message": "This chatbot intent is not enabled."
            }

        configured_function = intent_rows.iloc[0]["function_name"]

        # =========================================
        # 12. METRIC QUERY
        # =========================================

        if intent_code == "SHOW_METRIC":

            if not matched_metric:

                return {
                    "success": False,
                    "intent": intent_code,
                    "data": None,
                    "message": (
                        "Please specify which metric you want "
                        "to know about."
                    )
                }

            get_records = registry.get("get_all_records")

            if not get_records:

                return {
                    "success": False,
                    "intent": intent_code,
                    "data": None,
                    "message": "Metric function is unavailable."
                }

            records = get_records()

            if not records or "metrics" not in records:

                return {
                    "success": False,
                    "intent": intent_code,
                    "data": None,
                    "message": "Could not retrieve dashboard metrics."
                }

            metrics = records["metrics"]

            metric_key = matched_metric["metric_key"]

            if metric_key not in metrics:

                return {
                    "success": False,
                    "intent": intent_code,
                    "data": None,
                    "message": (
                        f"Metric '{metric_key}' is not available "
                        "in get_all_records()."
                    )
                }

            value = metrics[metric_key]

            return {
                "success": True,
                "intent": intent_code,
                "metric_key": metric_key,
                "data": {
                    "metric": matched_metric["display_name"],
                    "metric_key": metric_key,
                    "value": value
                },
                "message": (
                    f"{matched_metric['display_name']}: {value}"
                )
            }

        # =========================================
        # 13. ALL METRICS QUERY
        # =========================================

        if intent_code == "SHOW_ALL_METRICS":

            get_records = registry.get("get_all_records")

            if not get_records:

                return {
                    "success": False,
                    "intent": intent_code,
                    "data": None,
                    "message": "Metric function is unavailable."
                }

            records = get_records()

            if not records or "metrics" not in records:

                return {
                    "success": False,
                    "intent": intent_code,
                    "data": None,
                    "message": "Could not retrieve dashboard metrics."
                }

            return {
                "success": True,
                "intent": intent_code,
                "data": records["metrics"],
                "message": "All dashboard metrics retrieved successfully."
            }

        # =========================================
        # 14. VALIDATE FUNCTION AGAINST WHITELIST
        # =========================================

        if configured_function not in registry:

            return {
                "success": False,
                "intent": intent_code,
                "data": None,
                "message": (
                    "The configured function is not permitted "
                    "in the read-only chatbot."
                )
            }

        function = registry[configured_function]

        # =========================================
        # 15. BENEFICIARY HISTORY
        # =========================================

        if intent_code == "BENEFICIARY_HISTORY":

            if not beneficiary_id:

                return {
                    "success": False,
                    "intent": intent_code,
                    "data": None,
                    "message": (
                        "Please include a beneficiary ID. "
                        "Example: Show beneficiary B001 history."
                    )
                }

            result = function(
                beneficiary_id=beneficiary_id,
                start_date=start_date,
                end_date=end_date,
                status=status
            )

        # =========================================
        # 16. MOTHER PROFILE
        # =========================================

        elif intent_code == "MOTHER_PROFILE":

            if not beneficiary_id:

                return {
                    "success": False,
                    "intent": intent_code,
                    "data": None,
                    "message": (
                        "Please provide the beneficiary ID "
                        "to retrieve the mother's profile."
                    )
                }

            result = function(beneficiary_id)

        # =========================================
        # 17. CHILD PROFILE
        # =========================================

        elif intent_code == "CHILD_PROFILE":

            child_name = None

            # Find an exact child name in the database.
            # This avoids guessing names from free text.

            children_list = get_all_children_list()

            for child in children_list:

                name = str(
                    child.get("child_name") or ""
                ).strip()

                if not name:
                    continue

                if re.search(
                    r"(?<!\w)" + re.escape(name.lower()) + r"(?!\w)",
                    normalized
                ):

                    child_name = name
                    break

            if not beneficiary_id and not child_name:

                return {
                    "success": False,
                    "intent": intent_code,
                    "data": None,
                    "message": (
                        "Please provide a beneficiary ID or "
                        "the child's name."
                    )
                }

            result = function(
                beneficiary_id=beneficiary_id,
                child_name=child_name
            )

        # =========================================
        # 18. ASHA WORKER PROFILE
        # =========================================

        elif intent_code == "ASHA_PROFILE":

            result = function(worker_id)

        # =========================================
        # 19. MOTHER LIST
        # =========================================

        elif intent_code == "MOTHER_LIST":

            result = function()

        # =========================================
        # 20. CHILD LIST
        # =========================================

        elif intent_code == "CHILD_LIST":

            result = function()

        # =========================================
        # 21. FORMAT RESULT
        # =========================================

        if result is None:

            return {
                "success": False,
                "intent": intent_code,
                "data": None,
                "message": "No matching record was found."
            }

        if isinstance(result, pd.DataFrame):

            if result.empty:

                return {
                    "success": True,
                    "intent": intent_code,
                    "data": result,
                    "rows": 0,
                    "columns": list(result.columns),
                    "message": "No matching records found."
                }

            return {
                "success": True,
                "intent": intent_code,
                "data": result,
                "rows": len(result),
                "columns": list(result.columns),
                "message": (
                    f"Successfully retrieved {len(result)} record(s)."
                )
            }

        if isinstance(result, list):

            return {
                "success": True,
                "intent": intent_code,
                "data": result,
                "rows": len(result),
                "message": (
                    f"Successfully retrieved {len(result)} record(s)."
                )
            }

        if isinstance(result, dict):

            return {
                "success": True,
                "intent": intent_code,
                "data": result,
                "message": "Record retrieved successfully."
            }

        return {
            "success": True,
            "intent": intent_code,
            "data": result,
            "message": "Data retrieved successfully."
        }

    except Exception as e:

        print("handle_asha_query:", e)

        return {
            "success": False,
            "intent": None,
            "data": None,
            "message": f"Unable to process your request: {str(e)}"
        }

PARAMETER_ALIASES = {
    "ben_id": "beneficiary_id",
    "beneficiary_id": "beneficiary_id"
}



def _note_normalize(value):

    if value is None:
        return ""

    value = str(value).strip().lower()

    value = re.sub(r"\s+", " ", value)

    return value

def _note_extract_labelled_value(note, aliases):

    """
    Extracts a value appearing after a label.

    Example:
        "beneficiary ID: B001"
        alias = "beneficiary id"
        result = "B001"
    """

    if not note:
        return None

    for alias in aliases:

        alias = alias.strip()

        if not alias:
            continue

        pattern = (
            r"(?<!\w)"
            + re.escape(alias)
            + r"\s*[:=-]\s*"
            + r"(.+?)"
            + r"(?=\s*(?:,|;|\n|$))"
        )

        match = re.search(
            pattern,
            note,
            re.IGNORECASE
        )

        if match:

            value = match.group(1).strip()

            if value:
                return value

    return None

def _note_extract_beneficiary_id(note):

    match = re.search(
        r"\b(?:BENEFICIARY|BEN|B)[\s_-]*([A-Z]*\d+)\b",
        note,
        re.IGNORECASE
    )

    if not match:
        return None

    value = match.group(1).upper()

    # Normalize numeric-only IDs to B001 format.
    if value.isdigit():
        return "B" + value

    # Preserve an existing alphabetic prefix.
    return value

def _note_extract_dates(note):

    """
    Returns valid-looking date strings.
    Actual calendar validation occurs later.
    """

    return re.findall(
        r"\b\d{2}[-/]\d{2}[-/]\d{4}\b",
        note
    )

def extract_parameters(note, action_code):

    """
    Extract parameters based on the action's
    configuration in note_parameters.

    Returns a dictionary of extracted values.
    """

    conn = None

    try:

        conn = get_conn()

        rows = conn.execute("""
            SELECT
                parameter_name,
                aliases,
                data_type,
                default_value
            FROM note_parameters
            WHERE action_code = ?
            ORDER BY parameter_id
        """, (action_code,)).fetchall()

        if not rows:
            return {}

        extracted = {}

        original_note = str(note).strip()
        normalized = _note_normalize(original_note)

        # ----------------------------------------
        # 1. Extract beneficiary ID
        # ----------------------------------------

        beneficiary_id = _note_extract_beneficiary_id(
            original_note
        )

        if beneficiary_id:
            extracted["beneficiary_id"] = beneficiary_id

        # ----------------------------------------
        # 2. Extract labelled parameters
        # ----------------------------------------

        for row in rows:

            parameter_name = row[0]
            aliases_text = row[1] or ""
            data_type = row[2]
            default_value = row[3]

            aliases = [
                x.strip()
                for x in aliases_text.split("|")
                if x.strip()
            ]

            value = _note_extract_labelled_value(
                original_note,
                aliases
            )

            if value is not None:
                extracted[parameter_name] = value

            elif default_value is not None:
                extracted[parameter_name] = default_value

        # ----------------------------------------
        # 3. Extract dates
        # ----------------------------------------

        dates = _note_extract_dates(original_note)

        date_parameters = [
            "due_date",
            "exp_dd",
            "dd",
            "delivery_date",
            "dob",
            "next_visit",
            "administered_date"
        ]

        for parameter in date_parameters:

            if parameter in extracted:
                continue

            if not dates:
                continue

            if action_code == "ADD_PREGNANCY":

                if parameter == "exp_dd":
                    extracted[parameter] = dates[0]

                elif parameter == "dd" and len(dates) > 1:
                    extracted[parameter] = dates[1]

            elif action_code == "REGISTER_DELIVERY":

                if parameter == "delivery_date":
                    extracted[parameter] = dates[0]

                elif parameter == "next_visit" and len(dates) > 1:
                    extracted[parameter] = dates[1]

            elif action_code == "ADD_CHILD":

                if parameter == "dob":
                    extracted[parameter] = dates[0]

                elif parameter == "next_visit" and len(dates) > 1:
                    extracted[parameter] = dates[1]

            elif action_code == "UPDATE_VACCINE":

                if parameter == "administered_date":
                    extracted[parameter] = dates[0]

            elif action_code == "ADD_VISIT":

                if parameter == "due_date":
                    extracted[parameter] = dates[0]

        # ----------------------------------------
        # 4. Extract pregnancy week
        # ----------------------------------------

        if action_code == "ADD_PREGNANCY":

            match = re.search(
                r"\b(?:week|weeks|gestational week|pregnancy week)"
                r"\s*(?:is|of|:|=)?\s*(\d{1,2})\b",
                normalized
            )

            if match:
                extracted["week"] = match.group(1)

        # ----------------------------------------
        # 5. Extract gender
        # ----------------------------------------

        if action_code in ("ADD_CHILD", "REGISTER_DELIVERY"):

            match = re.search(
                r"\b(?:gender|sex)\s*(?:is|:|=)?\s*"
                r"(male|female|m|f)\b",
                normalized
            )

            if match:

                gender = match.group(1).upper()

                extracted["gender"] = (
                    "M" if gender in ("M", "MALE") else "F"
                )

        # ----------------------------------------
        # 6. Extract weight
        # ----------------------------------------

        if action_code in ("ADD_CHILD", "REGISTER_DELIVERY"):

            match = re.search(
                r"\b(?:birth weight|baby weight|weight)"
                r"\s*(?:is|:|=)?\s*(\d+(?:\.\d+)?)"
                r"\s*(?:kg|kgs|kilograms)?\b",
                normalized
            )

            if match:
                extracted["weight"] = match.group(1)

        # ----------------------------------------
        # 7. Extract child name
        # ----------------------------------------

        if action_code in ("ADD_CHILD", "REGISTER_DELIVERY"):

            name_match = re.search(
                r"\b(?:child name|baby name|newborn name)"
                r"\s*(?:is|:|=)?\s*"
                r"([a-z][a-z .'-]{0,60}?)"
                r"(?=\s*(?:,|;|\band\b|\bgender\b|\bsex\b|$))",
                original_note,
                re.IGNORECASE
            )

            if name_match:
                extracted["child_name"] = (
                    name_match.group(1).strip()
                )

        # ----------------------------------------
        # 8. Extract vaccine and mode
        # ----------------------------------------

        if action_code == "UPDATE_VACCINE":

            vaccine_match = re.search(
                r"\b(?:vaccine|vaccine name|dose)"
                r"\s*(?:is|:|=)?\s*"
                r"([A-Za-z0-9][A-Za-z0-9 -]{0,40}?)"
                r"(?=\s*(?:,|;|\band\b|\bgiven\b|\badministered\b|$))",
                original_note,
                re.IGNORECASE
            )

            if vaccine_match:
                extracted["vaccine"] = (
                    vaccine_match.group(1).strip()
                )

            if re.search(r"\bmother\b", normalized):
                extracted["mode"] = "mother"

            elif re.search(r"\bchild\b|\bbaby\b", normalized):
                extracted["mode"] = "child"

        # ----------------------------------------
        # 9. Extract visit ID
        # ----------------------------------------

        if action_code == "UPDATE_VISIT":

            match = re.search(
                r"\bV[\s_-]?(\d+)\b",
                original_note,
                re.IGNORECASE
            )

            if match:
                extracted["visit_id"] = (
                    "V" + match.group(1).zfill(3)
                )

        # ----------------------------------------
        # 10. Preserve visit note and voice
        # ----------------------------------------

        if action_code == "UPDATE_VISIT":

            note_match = re.search(
                r"\b(?:note|observation|remarks)"
                r"\s*[:=-]\s*(.+)$",
                original_note,
                re.IGNORECASE | re.DOTALL
            )

            voice_match = re.search(
                r"\b(?:voice|transcription|spoken note)"
                r"\s*[:=-]\s*(.+?)"
                r"(?=\s*(?:,|;|\n)|$)",
                original_note,
                re.IGNORECASE
            )

            if note_match:
                extracted["note"] = note_match.group(1).strip()

            if voice_match:
                extracted["voice"] = voice_match.group(1).strip()

            # Do not silently invent a voice transcription.
            # The caller must supply voice if it is required.

        # ----------------------------------------
        # 11. Return
        # ----------------------------------------

        return extracted

    except Exception as e:

        print("extract_parameters:", e)
        return {}

def validate_parameter_values(action_code, parameters):

    """
    Validates extracted values before any write function is called.

    Returns:
        {
            "valid": bool,
            "errors": [],
            "parameters": {}
        }
    """

    conn = None

    errors = []
    cleaned = dict(parameters or {})

    try:

        conn = get_conn()

        # ----------------------------------------
        # 1. Load parameter definitions
        # ----------------------------------------

        definitions = conn.execute("""
            SELECT
                parameter_name,
                required,
                data_type,
                validation_rule
            FROM note_parameters
            WHERE action_code = ?
        """, (action_code,)).fetchall()

        if not definitions:

            return {
                "valid": False,
                "errors": ["No parameter configuration found."],
                "parameters": cleaned
            }

        # ----------------------------------------
        # 2. Required field validation
        # ----------------------------------------

        for name, required, data_type, rule in definitions:

            value = cleaned.get(name)

            if required and (
                value is None
                or str(value).strip().upper() in ("", "NONE", "NULL")
            ):

                errors.append(
                    f"Missing required field: {name}"
                )

        if errors:
            return {
                "valid": False,
                "errors": errors,
                "parameters": cleaned
            }

        # ----------------------------------------
        # 3. Type validation
        # ----------------------------------------

        for name, required, data_type, rule in definitions:

            value = cleaned.get(name)

            if value is None or str(value).strip() == "":
                continue

            try:

                if data_type == "date":

                    parsed = datetime.strptime(
                        str(value).strip().replace("/", "-"),
                        "%d-%m-%Y"
                    )

                    cleaned[name] = parsed.strftime("%d-%m-%Y")

                    if name in ("dob", "delivery_date", "administered_date"):

                        if parsed.date() > date.today():

                            errors.append(
                                f"{name} cannot be in the future."
                            )

                elif data_type == "integer":

                    number = int(value)

                    if number <= 0:
                        raise ValueError("Must be greater than zero.")

                    cleaned[name] = number

                elif data_type == "number":

                    number = float(value)

                    if number <= 0:
                        raise ValueError("Must be greater than zero.")

                    cleaned[name] = number

                elif data_type == "gender":

                    gender = str(value).strip().upper()

                    if gender in ("MALE", "M"):
                        cleaned[name] = "M"

                    elif gender in ("FEMALE", "F"):
                        cleaned[name] = "F"

                    else:
                        raise ValueError("Gender must be M or F.")

                elif data_type == "choice":

                    allowed = [
                        x.strip().lower()
                        for x in str(rule or "").split("|")
                    ]

                    choice = str(value).strip().lower()

                    if choice not in allowed:
                        raise ValueError(
                            "Allowed values: " + ", ".join(allowed)
                        )

                    cleaned[name] = choice

                elif data_type == "json":

                    if isinstance(value, dict):
                        cleaned[name] = value
                    else:
                        parsed = json.loads(value)

                        if not isinstance(parsed, dict):
                            raise ValueError(
                                "Must be a JSON object."
                            )

                        cleaned[name] = parsed

            except (ValueError, TypeError, json.JSONDecodeError) as e:

                errors.append(f"Invalid {name}: {e}")

        # ----------------------------------------
        # 4. Action-specific validation
        # ----------------------------------------

        ben_id = cleaned.get("beneficiary_id")

        if ben_id:

            exists = conn.execute("""
                SELECT 1
                FROM home_records
                WHERE beneficiary_id = ?
                LIMIT 1
            """, (ben_id,)).fetchone()

            if not exists:

                errors.append(
                    f"Beneficiary {ben_id} does not exist in home_records."
                )

        if action_code == "ADD_PREGNANCY":

            week = cleaned.get("week")

            if week is not None and not 1 <= int(week) <= 45:
                errors.append(
                    "Pregnancy week must be between 1 and 45."
                )

        if action_code == "ADD_CHILD":

            child_name = cleaned.get("child_name")

            if child_name:

                exists = conn.execute("""
                    SELECT 1
                    FROM children
                    WHERE child_name = ?
                """, (child_name,)).fetchone()

                if exists:
                    errors.append(
                        f"Child name '{child_name}' already exists. "
                        "The current children table uses child_name as its primary key."
                    )

            dob = cleaned.get("dob")

            if dob:
                dob_date = datetime.strptime(
                    dob, "%d-%m-%Y"
                ).date()

                if dob_date > date.today():
                    errors.append("Child DOB cannot be in the future.")

        if action_code == "REGISTER_DELIVERY":

            active = conn.execute("""
                SELECT 1
                FROM pregnancies
                WHERE beneficiary_id = ?
                  AND COALESCE(UPPER(TRIM(status)), '') != 'COMPLETED'
                LIMIT 1
            """, (ben_id,)).fetchone()

            if not active:
                errors.append(
                    "No active pregnancy was found for this beneficiary."
                )

            child_name = cleaned.get("child_name")

            if child_name:

                duplicate = conn.execute("""
                    SELECT 1
                    FROM children
                    WHERE child_name = ?
                """, (child_name,)).fetchone()

                if duplicate:
                    errors.append(
                        f"Child name '{child_name}' already exists."
                    )

        if action_code == "UPDATE_VISIT":

            visit_id = cleaned.get("visit_id")

            if visit_id and ben_id:

                exists = conn.execute("""
                    SELECT 1
                    FROM visits
                    WHERE id = ?
                      AND beneficiary_id = ?
                """, (visit_id, ben_id)).fetchone()

                if not exists:
                    errors.append(
                        "Visit ID does not belong to this beneficiary."
                    )

        if action_code == "UPDATE_VACCINE":

            mode = cleaned.get("mode", "child")

            if mode == "child" and not cleaned.get("child_name"):

                errors.append(
                    "Child name is required when recording a child vaccine."
                )

            if mode == "child" and cleaned.get("child_name"):

                exists = conn.execute("""
                    SELECT 1
                    FROM children
                    WHERE beneficiary_id = ?
                      AND child_name = ?
                """, (
                    ben_id,
                    cleaned["child_name"]
                )).fetchone()

                if not exists:
                    errors.append(
                        "Child record was not found for this beneficiary."
                    )

            if mode == "mother":

                exists = conn.execute("""
                    SELECT 1
                    FROM pregnancies
                    WHERE beneficiary_id = ?
                    LIMIT 1
                """, (ben_id,)).fetchone()

                if not exists:
                    errors.append(
                        "No pregnancy record was found for this beneficiary."
                    )

        return {
            "valid": len(errors) == 0,
            "errors": errors,
            "parameters": cleaned
        }

    except Exception as e:

        return {
            "valid": False,
            "errors": [str(e)],
            "parameters": cleaned
        }

def parse_note(note):

    """
    Identifies one intended action from a natural-language note.

    Returns a list of action plans for compatibility with
    the workflow resolver.

    No database writes are performed here.
    """

    conn = None

    try:

        if not note or not str(note).strip():

            return []

        original_note = str(note).strip()
        normalized = _note_normalize(original_note)

        conn = get_conn()

        actions = conn.execute("""
            SELECT
                action_code,
                action_name,
                function_name,
                requires_confirmation
            FROM note_actions
            WHERE enabled = 1
        """).fetchall()

        if not actions:
            return []

        action_map = {
            row[0]: {
                "action_name": row[1],
                "function_name": row[2],
                "requires_confirmation": bool(row[3])
            }
            for row in actions
        }

        scores = {
            code: 0
            for code in action_map
        }

        matched_keywords = {
            code: []
            for code in action_map
        }

        # ----------------------------------------
        # Load all four keyword tables
        # ----------------------------------------

        keyword_tables = [
            "note_keyword1",
            "note_keyword2",
            "note_keyword3",
            "note_keyword4"
        ]

        for table in keyword_tables:

            rows = conn.execute(f"""
                SELECT action_code, keyword, weight
                FROM {table}
            """).fetchall()

            for action_code, keyword, weight in rows:

                if action_code not in scores:
                    continue

                keyword = _note_normalize(keyword)

                if not keyword:
                    continue

                pattern = (
                    r"(?<!\w)"
                    + re.escape(keyword)
                    + r"(?!\w)"
                )

                if re.search(pattern, normalized):

                    scores[action_code] += int(weight)

                    matched_keywords[action_code].append(keyword)

        # ----------------------------------------
        # Require a meaningful action match
        # ----------------------------------------

        if not scores or max(scores.values()) < 5:
            return []

        # ----------------------------------------
        # Identify highest-scoring action
        # ----------------------------------------

        ranked = sorted(
            scores.items(),
            key=lambda item: item[1],
            reverse=True
        )

        best_code, best_score = ranked[0]

        # If the two highest scores tie, do not guess.
        if len(ranked) > 1:

            second_code, second_score = ranked[1]

            if second_score == best_score:

                return [{
                    "action_code": None,
                    "action_name": None,
                    "function_name": None,
                    "parameters": {},
                    "requires_confirmation": True,
                    "status": "AMBIGUOUS",
                    "message": (
                        "The note matches multiple actions: "
                        f"{action_map[best_code]['action_name']} and "
                        f"{action_map[second_code]['action_name']}. "
                        "Please clarify the intended action."
                    )
                }]

        action = action_map[best_code]

        return [{
            "action_code": best_code,
            "action_name": action["action_name"],
            "function_name": action["function_name"],
            "matched_keywords": matched_keywords[best_code],
            "score": best_score,
            "note": original_note,
            "parameters": {},
            "requires_confirmation": action["requires_confirmation"],
            "status": "IDENTIFIED"
        }]

    except Exception as e:

        print("parse_note:", e)
        return []

def resolve_parameters(note, parse_result):

    """
    Extracts and validates parameters for identified actions.

    Does not execute any write function.
    """

    resolved = []

    if not parse_result:
        return resolved

    for action in parse_result:

        action_code = action.get("action_code")

        if not action_code:

            resolved.append({
                **action,
                "status": "AMBIGUOUS",
                "valid": False,
                "errors": [
                    action.get(
                        "message",
                        "Action could not be identified."
                    )
                ]
            })

            continue

        # ----------------------------------------
        # 1. Extract parameters
        # ----------------------------------------

        extracted = extract_parameters(
            note,
            action_code
        )

        # ----------------------------------------
        # 2. Validate parameters
        # ----------------------------------------

        validation = validate_parameter_values(
            action_code,
            extracted
        )

        resolved.append({

            "action_code": action_code,

            "action_name": action.get("action_name"),

            "function_name": action.get("function_name"),

            "parameters": validation["parameters"],

            "valid": validation["valid"],

            "errors": validation["errors"],

            "requires_confirmation": action.get(
                "requires_confirmation", True
            ),

            "status": (
                "READY"
                if validation["valid"]
                else "MISSING_PARAMETERS"
            ),

            "message": (
                "All parameters are valid."
                if validation["valid"]
                else "Some required parameters are missing or invalid."
            )
        })

    return resolved




def setup_note_parser_tables():

    conn = None

    try:
        conn = get_conn()
        cursor = conn.cursor()

        cursor.executescript("""
            PRAGMA foreign_keys = ON;

            CREATE TABLE IF NOT EXISTS note_actions (
                action_id INTEGER PRIMARY KEY AUTOINCREMENT,
                action_code TEXT NOT NULL UNIQUE,
                action_name TEXT NOT NULL,
                description TEXT,
                function_name TEXT NOT NULL,
                enabled INTEGER NOT NULL DEFAULT 1,
                requires_confirmation INTEGER NOT NULL DEFAULT 1
            );

            CREATE TABLE IF NOT EXISTS note_keyword1 (
                keyword_id INTEGER PRIMARY KEY AUTOINCREMENT,
                action_code TEXT NOT NULL,
                keyword TEXT NOT NULL,
                weight INTEGER NOT NULL DEFAULT 1,
                FOREIGN KEY (action_code)
                    REFERENCES note_actions(action_code)
                    ON DELETE CASCADE,
                UNIQUE(action_code, keyword)
            );

            CREATE TABLE IF NOT EXISTS note_keyword2 (
                keyword_id INTEGER PRIMARY KEY AUTOINCREMENT,
                action_code TEXT NOT NULL,
                keyword TEXT NOT NULL,
                weight INTEGER NOT NULL DEFAULT 1,
                FOREIGN KEY (action_code)
                    REFERENCES note_actions(action_code)
                    ON DELETE CASCADE,
                UNIQUE(action_code, keyword)
            );

            CREATE TABLE IF NOT EXISTS note_keyword3 (
                keyword_id INTEGER PRIMARY KEY AUTOINCREMENT,
                action_code TEXT NOT NULL,
                keyword TEXT NOT NULL,
                weight INTEGER NOT NULL DEFAULT 1,
                FOREIGN KEY (action_code)
                    REFERENCES note_actions(action_code)
                    ON DELETE CASCADE,
                UNIQUE(action_code, keyword)
            );

            CREATE TABLE IF NOT EXISTS note_keyword4 (
                keyword_id INTEGER PRIMARY KEY AUTOINCREMENT,
                action_code TEXT NOT NULL,
                keyword TEXT NOT NULL,
                weight INTEGER NOT NULL DEFAULT 1,
                FOREIGN KEY (action_code)
                    REFERENCES note_actions(action_code)
                    ON DELETE CASCADE,
                UNIQUE(action_code, keyword)
            );

            CREATE TABLE IF NOT EXISTS note_parameters (
                parameter_id INTEGER PRIMARY KEY AUTOINCREMENT,
                action_code TEXT NOT NULL,
                parameter_name TEXT NOT NULL,
                aliases TEXT,
                required INTEGER NOT NULL DEFAULT 0,
                data_type TEXT NOT NULL DEFAULT 'text',
                validation_rule TEXT,
                default_value TEXT,
                description TEXT,
                FOREIGN KEY (action_code)
                    REFERENCES note_actions(action_code)
                    ON DELETE CASCADE,
                UNIQUE(action_code, parameter_name)
            );

            CREATE INDEX IF NOT EXISTS idx_note_actions_enabled
            ON note_actions(enabled);

            CREATE INDEX IF NOT EXISTS idx_note_keyword1_action
            ON note_keyword1(action_code);

            CREATE INDEX IF NOT EXISTS idx_note_keyword2_action
            ON note_keyword2(action_code);

            CREATE INDEX IF NOT EXISTS idx_note_keyword3_action
            ON note_keyword3(action_code);

            CREATE INDEX IF NOT EXISTS idx_note_keyword4_action
            ON note_keyword4(action_code);

            CREATE INDEX IF NOT EXISTS idx_note_parameters_action
            ON note_parameters(action_code);
        """)

        # ----------------------------------------
        # ACTIONS
        # ----------------------------------------

        actions = [
            (
                "ADD_VISIT",
                "Schedule Visit",
                "Create a new pending visit",
                "add_new_visits",
                1,
                1
            ),
            (
                "ADD_PREGNANCY",
                "Register Pregnancy",
                "Create a new pregnancy record",
                "add_new_pregnancy",
                1,
                1
            ),
            (
                "REGISTER_DELIVERY",
                "Register Delivery",
                "Complete a pregnancy and register a newborn",
                "register_delivery",
                1,
                1
            ),
            (
                "ADD_CHILD",
                "Register Child",
                "Create a new child record",
                "add_child",
                1,
                1
            ),
            (
                "UPDATE_VISIT",
                "Complete Visit",
                "Record a completed visit and calculate its next visit",
                "update_visit",
                1,
                1
            ),
            (
                "UPDATE_VACCINE",
                "Record Vaccination",
                "Record an administered vaccine",
                "update_vac",
                1,
                1
            )
        ]

        cursor.executemany("""
            INSERT OR IGNORE INTO note_actions (
                action_code,
                action_name,
                description,
                function_name,
                enabled,
                requires_confirmation
            )
            VALUES (?, ?, ?, ?, ?, ?)
        """, actions)

        # ----------------------------------------
        # KEYWORD GROUPS
        # ----------------------------------------

        keyword_groups = {

            "note_keyword1": {
                "ADD_VISIT": [
                    ("schedule visit", 10),
                    ("add visit", 10),
                    ("create visit", 9),
                    ("book visit", 9),
                    ("plan visit", 8),
                    ("new visit", 8)
                ],
                "ADD_PREGNANCY": [
                    ("register pregnancy", 10),
                    ("add pregnancy", 10),
                    ("new pregnancy", 9),
                    ("record pregnancy", 9),
                    ("pregnancy registration", 9)
                ],
                "REGISTER_DELIVERY": [
                    ("register delivery", 10),
                    ("record delivery", 10),
                    ("delivery completed", 9),
                    ("baby delivered", 9),
                    ("register childbirth", 9),
                    ("delivery registration", 10)
                ],
                "ADD_CHILD": [
                    ("register child", 10),
                    ("add child", 10),
                    ("new child", 9),
                    ("child registration", 9),
                    ("register baby", 9),
                    ("add newborn", 9)
                ],
                "UPDATE_VISIT": [
                    ("complete visit", 10),
                    ("update visit", 10),
                    ("record visit", 9),
                    ("submit visit", 9),
                    ("visit completed", 9),
                    ("save visit details", 9)
                ],
                "UPDATE_VACCINE": [
                    ("record vaccination", 10),
                    ("update vaccination", 10),
                    ("vaccine administered", 10),
                    ("record vaccine", 9),
                    ("vaccination completed", 9),
                    ("administered vaccine", 9)
                ]
            },

            "note_keyword2": {
                "ADD_VISIT": [
                    ("follow up visit", 8),
                    ("medical visit", 7),
                    ("home visit", 7)
                ],
                "ADD_PREGNANCY": [
                    ("pregnant", 7),
                    ("pregnancy confirmed", 9),
                    ("expecting a baby", 7)
                ],
                "REGISTER_DELIVERY": [
                    ("gave birth", 9),
                    ("delivered a baby", 9),
                    ("newborn delivered", 9)
                ],
                "ADD_CHILD": [
                    ("newborn", 7),
                    ("infant registration", 8),
                    ("child details", 6)
                ],
                "UPDATE_VISIT": [
                    ("visited household", 7),
                    ("home visit completed", 9),
                    ("beneficiary visited", 8)
                ],
                "UPDATE_VACCINE": [
                    ("immunization", 8),
                    ("vaccine dose", 8),
                    ("vaccination dose", 8)
                ]
            },

            "note_keyword3": {
                "ADD_VISIT": [
                    ("next visit", 5),
                    ("visit due", 5)
                ],
                "ADD_PREGNANCY": [
                    ("gestational week", 7),
                    ("pregnancy week", 7)
                ],
                "REGISTER_DELIVERY": [
                    ("birth weight", 7),
                    ("date of delivery", 7)
                ],
                "ADD_CHILD": [
                    ("child name", 5),
                    ("date of birth", 5)
                ],
                "UPDATE_VISIT": [
                    ("visit note", 5),
                    ("visit report", 5)
                ],
                "UPDATE_VACCINE": [
                    ("vaccine name", 5),
                    ("administration date", 6)
                ]
            },

            "note_keyword4": {
                "ADD_VISIT": [
                    ("routine checkup", 5),
                    ("follow up", 4)
                ],
                "ADD_PREGNANCY": [
                    ("expected delivery", 6),
                    ("expected delivery date", 7)
                ],
                "REGISTER_DELIVERY": [
                    ("newborn details", 7),
                    ("child delivered", 8)
                ],
                "ADD_CHILD": [
                    ("baby details", 6),
                    ("newborn details", 7)
                ],
                "UPDATE_VISIT": [
                    ("health assessment", 5),
                    ("beneficiary condition", 5)
                ],
                "UPDATE_VACCINE": [
                    ("td dose", 6),
                    ("bcg dose", 6),
                    ("pentavalent dose", 6)
                ]
            }
        }

        for table_name, action_map in keyword_groups.items():

            for action_code, entries in action_map.items():

                cursor.executemany(
                    f"""
                    INSERT OR IGNORE INTO {table_name}
                    (action_code, keyword, weight)
                    VALUES (?, ?, ?)
                    """,
                    [
                        (action_code, keyword, weight)
                        for keyword, weight in entries
                    ]
                )

        # ----------------------------------------
        # PARAMETER DEFINITIONS
        # ----------------------------------------

        parameter_definitions = {

            "ADD_VISIT": [
                ("beneficiary_id", "beneficiary id|beneficiary|ben id", 1, "text", "beneficiary_id", None, "Household ID"),
                ("v_type", "visit type|visit category|type", 1, "text", None, None, "Visit type"),
                ("due_date", "due date|visit date|scheduled date|on", 1, "date", "DD-MM-YYYY", None, "Scheduled visit date")
            ],

            "ADD_PREGNANCY": [
                ("beneficiary_id", "beneficiary id|beneficiary|ben id", 1, "text", "beneficiary_id", None, "Household ID"),
                ("week", "pregnancy week|gestational week|week", 1, "integer", "positive", None, "Current pregnancy week"),
                ("exp_dd", "expected delivery date|expected date of delivery|edd|exp dd", 1, "date", "DD-MM-YYYY", None, "Expected delivery date"),
                ("dd", "delivery date|actual delivery date", 0, "date", "DD-MM-YYYY", None, "Actual delivery date, if already delivered")
            ],

            "REGISTER_DELIVERY": [
                ("beneficiary_id", "beneficiary id|beneficiary|ben id", 1, "text", "beneficiary_id", None, "Household ID"),
                ("delivery_date", "delivery date|date of delivery|delivered on", 1, "date", "DD-MM-YYYY", None, "Actual delivery date"),
                ("child_name", "child name|baby name|newborn name", 1, "text", None, None, "Newborn's name"),
                ("gender", "gender|sex", 1, "gender", "M/F", None, "Newborn's gender"),
                ("weight", "birth weight|baby weight|weight", 1, "number", "positive", None, "Birth weight in kg"),
                ("next_visit", "next visit|next visit date|follow up date", 1, "date", "DD-MM-YYYY", None, "Newborn's next visit")
            ],

            "ADD_CHILD": [
                ("beneficiary_id", "beneficiary id|beneficiary|ben id", 1, "text", "beneficiary_id", None, "Household ID"),
                ("child_name", "child name|baby name|newborn name", 1, "text", None, None, "Child name"),
                ("gender", "gender|sex", 1, "gender", "M/F", None, "Child gender"),
                ("dob", "date of birth|birth date|dob|born on", 1, "date", "DD-MM-YYYY", None, "Date of birth"),
                ("weight", "weight|birth weight", 1, "number", "positive", None, "Weight in kg"),
                ("vacs_taken", "vaccines taken|vaccines administered", 0, "json", None, "{}", "Actual administered vaccines"),
                ("next_visit", "next visit|next visit date", 1, "date", "DD-MM-YYYY", None, "Next visit date")
            ],

            "UPDATE_VISIT": [
                ("visit_id", "visit id|visit number", 1, "text", None, None, "Existing visit ID"),
                ("beneficiary_id", "beneficiary id|beneficiary|ben id", 1, "text", "beneficiary_id", None, "Household ID"),
                ("voice", "voice|transcription|spoken note", 1, "text", None, None, "Voice transcription"),
                ("note", "note|observation|remarks|health observation", 1, "text", None, None, "Visit observation"),
                ("visit_type", "visit type|visit category|type", 1, "text", None, None, "Visit type")
            ],

            "UPDATE_VACCINE": [
                ("beneficiary_id", "beneficiary id|beneficiary|ben id", 1, "text", "beneficiary_id", None, "Household ID"),
                ("vaccine", "vaccine|vaccine name|dose", 1, "text", None, None, "Vaccine administered"),
                ("administered_date", "administered date|vaccination date|given on|date", 1, "date", "DD-MM-YYYY", None, "Actual administration date"),
                ("mode", "mode|recipient", 1, "choice", "child|mother", "child", "Whether child or mother"),
                ("child_name", "child name|baby name", 0, "text", None, None, "Required when mode is child"),
                ("pregnancy_rowid", "pregnancy row id|pregnancy id", 0, "integer", "positive", None, "Specific pregnancy row, if needed")
            ]
        }

        for action_code, parameters in parameter_definitions.items():

            cursor.executemany("""
                INSERT OR IGNORE INTO note_parameters (
                    action_code,
                    parameter_name,
                    aliases,
                    required,
                    data_type,
                    validation_rule,
                    default_value,
                    description
                )
                VALUES (?, ?, ?, ?, ?, ?, ?, ?)
            """, [
                (
                    action_code,
                    name,
                    aliases,
                    required,
                    data_type,
                    validation_rule,
                    default_value,
                    description
                )
                for (
                    name,
                    aliases,
                    required,
                    data_type,
                    validation_rule,
                    default_value,
                    description
                ) in parameters
            ])

        conn.commit()

        return {
            "success": True,
            "message": "Note parser tables created and populated.",
            "actions": len(actions)
        }

    except Exception as e:

        if conn:
            conn.rollback()

        print("setup_note_parser_tables:", e)

        return {
            "success": False,
            "message": str(e)
        }



# =========================================================
# 1. GENERAL EXTRACTION HELPERS
# =========================================================









# =========================================================
# 2. DATE EXTRACTION
# =========================================================





# =========================================================
# 3. EXTRACT ALL AVAILABLE NOTE PARAMETERS
# =========================================================



# =========================================================
# 4. PARAMETER VALIDATION
# =========================================================



# =========================================================
# WORKFLOW EXECUTION MANAGER
# =========================================================

def execute_workflow(resolved_result, confirmed=False):
    """
    Execute the function plan returned by resolve_parameters().

    Parameters:
        resolved_result: Output of resolve_parameters()
        confirmed: Explicit ASHA worker confirmation

    Returns:
        Execution report for every function.

    Only approved backend functions can be executed.
    """

    execution_log = []

    try:

        # -----------------------------------------
        # STEP 1: Validate resolver output
        # -----------------------------------------

        if not isinstance(resolved_result, dict):
            raise ValueError("Invalid workflow data.")

        if not resolved_result.get("success"):
            raise ValueError("Parameter resolution was unsuccessful.")

        plan = resolved_result.get("function_plan", [])

        if not plan:
            return {
                "success": False,
                "message": "No functions available to execute.",
                "execution_log": []
            }

        if not resolved_result.get("ready_for_execution"):
            return {
                "success": False,
                "message": "Workflow has unresolved parameters.",
                "missing_parameters": resolved_result.get(
                    "missing_parameters", []
                ),
                "execution_log": []
            }

        # -----------------------------------------
        # STEP 2: Require confirmation
        # -----------------------------------------

        if not confirmed:
            return {
                "success": False,
                "requires_confirmation": True,
                "message": "ASHA worker confirmation required.",
                "function_plan": plan,
                "execution_log": []
            }

        # -----------------------------------------
        # STEP 3: Approved function registry
        # -----------------------------------------

        # Explicitly define allowed arguments for
        # each backend function.

        function_registry = {

            "register_delivery": {
                "function": register_delivery,
                "parameters": [
                    "beneficiary_id",
                    "delivery_date"
                ]
            },

            "add_child": {
                "function": add_child,
                "parameters": [
                    "beneficiary_id",
                    "child_name",
                    "gender",
                    "dob",
                    "weight",
                    "vacs_taken",
                    "next_visit"
                ]
            },

            "add_new_visits": {
                "function": add_new_visits,
                "parameters": [
                    "ben_id",
                    "v_type",
                    "due_date"
                ]
            },

            "update_visit": {
                "function": update_visit,
                "parameters": [
                    "visit_id",
                    "beneficiary_id",
                    "voice",
                    "note",
                    "visit_type"
                ]
            }
        }

        # -----------------------------------------
        # STEP 4: Execute functions chronologically
        # -----------------------------------------

        ordered_plan = sorted(
            plan,
            key=lambda item: item.get("step", 999)
        )

        for item in ordered_plan:

            function_name = item.get("function")
            step = item.get("step")

            # Check function authorization.
            if function_name not in function_registry:

                execution_log.append({
                    "step": step,
                    "function": function_name,
                    "status": "REJECTED",
                    "message": "Function is not authorized."
                })

                break

            function_config = function_registry[function_name]

            backend_function = function_config["function"]
            allowed_parameters = function_config["parameters"]

            # Check readiness.
            if item.get("status") != "READY":

                execution_log.append({
                    "step": step,
                    "function": function_name,
                    "status": "SKIPPED",
                    "message": "Required parameters are incomplete."
                })

                break

            # -------------------------------------
            # STEP 5: Prepare function arguments
            # -------------------------------------

            supplied_arguments = item.get("arguments", {})

            arguments = {
                parameter: supplied_arguments[parameter]
                for parameter in allowed_parameters
                if parameter in supplied_arguments
            }

            # Check missing function arguments.
            missing = [
                parameter
                for parameter in allowed_parameters
                if parameter not in arguments
                or arguments[parameter] is None
            ]

            if missing:

                execution_log.append({
                    "step": step,
                    "function": function_name,
                    "status": "FAILED",
                    "message": "Missing function arguments.",
                    "missing_parameters": missing
                })

                break

            # -------------------------------------
            # STEP 6: Execute approved function
            # -------------------------------------

            try:

                result = backend_function(**arguments)

                # Standardize success detection.
                if isinstance(result, dict):

                    if "res" in result:
                        operation_success = result["res"] is True

                    elif "success" in result:
                        operation_success = result["success"] is True

                    else:
                        operation_success = False

                elif isinstance(result, bool):
                    operation_success = result

                else:
                    # Backend functions must return an
                    # explicit success value.
                    operation_success = False

                execution_log.append({
                    "step": step,
                    "function": function_name,
                    "status": (
                        "COMPLETED"
                        if operation_success
                        else "FAILED"
                    ),
                    "arguments": arguments,
                    "result": result
                })

                # Stop if any operation fails.
                if not operation_success:
                    break

            except Exception as e:

                execution_log.append({
                    "step": step,
                    "function": function_name,
                    "status": "FAILED",
                    "arguments": arguments,
                    "error": str(e)
                })

                break

        # -----------------------------------------
        # STEP 7: Final execution report
        # -----------------------------------------

        completed = sum(
            1 for item in execution_log
            if item["status"] == "COMPLETED"
        )

        failed = sum(
            1 for item in execution_log
            if item["status"] in ("FAILED", "REJECTED")
        )

        skipped = sum(
            1 for item in execution_log
            if item["status"] == "SKIPPED"
        )

        all_completed = (
            completed == len(ordered_plan)
            and failed == 0
            and skipped == 0
        )
        return {
            "success": all_completed,
            "total_functions": len(ordered_plan),
            "completed": completed,
            "failed": failed,
            "skipped": skipped,
            "execution_log": execution_log,
            "message": (
                "Workflow completed successfully."
                if all_completed
                else "Workflow stopped or completed partially."
            )
        }
        
    except Exception as e:

        return {
            "success": False,
            "message": str(e),
            "execution_log": execution_log
        }




def get_beneficiary_history_df(
    beneficiary_id=None,
    start_date=None,
    end_date=None,
    status=None
):
    """
    Returns a beneficiary-wise profile and visit history DataFrame.

    One row per visit.
    Beneficiaries without visits are also included.

    Filters:
        beneficiary_id: Optional beneficiary ID.
        start_date: Optional DD-MM-YYYY.
        end_date: Optional DD-MM-YYYY.
        status: Optional household status.
    """

    conn = None

    try:
        conn = get_conn()

        # -----------------------------------------
        # 1. Retrieve household records
        # -----------------------------------------
        homes = pd.read_sql_query("""
            SELECT
                beneficiary_id,
                address,
                status AS home_status
            FROM home_records
        """, conn)

        if homes.empty:
            return pd.DataFrame()

        # -----------------------------------------
        # 2. Retrieve child records
        # -----------------------------------------
        children = pd.read_sql_query("""
            SELECT
                beneficiary_id,
                child_name,
                dob,
                age,
                gender,
                weight,
                vacs_taken,
                vacs_due,
                next_vac_n_due,
                next_visit
            FROM children
        """, conn)

        # -----------------------------------------
        # 3. Retrieve pregnancy records
        # -----------------------------------------
        pregnancies = pd.read_sql_query("""
            SELECT
                beneficiary_id,
                week,
                exp_dd,
                dd,
                status AS pregnancy_status,
                vacs_taken,
                vac_due,
                next_vac_n_due
            FROM pregnancies
        """, conn)

        # -----------------------------------------
        # 4. Retrieve visit history
        # -----------------------------------------
        visits = pd.read_sql_query("""
            SELECT
                id AS visit_id,
                beneficiary_id,
                voice,
                note,
                type AS visit_type,
                due_date,
                visit_ts,
                flag
            FROM visits
        """, conn)

        # -----------------------------------------
        # 5. Decode JSON safely
        # -----------------------------------------
        def decode_json(value):

            if isinstance(value, dict):
                return value

            if not value or str(value).strip().upper() in (
                "NONE", "NULL", ""
            ):
                return {}

            try:
                result = json.loads(value)

                return result if isinstance(result, dict) else {}

            except (json.JSONDecodeError, TypeError):
                return {}

        # -----------------------------------------
        # 6. Aggregate child information
        # -----------------------------------------
        child_records = {}

        for _, child in children.iterrows():

            ben_id = child["beneficiary_id"]

            record = {
                "child_name": child["child_name"],
                "dob": child["dob"],
                "age": child["age"],
                "gender": child["gender"],
                "weight": child["weight"],
                "vacs_taken": decode_json(child["vacs_taken"]),
                "vacs_due": decode_json(child["vacs_due"]),
                "next_vac_n_due": decode_json(
                    child["next_vac_n_due"]
                ),
                "next_visit": child["next_visit"]
            }

            child_records.setdefault(ben_id, []).append(record)

        # -----------------------------------------
        # 7. Aggregate pregnancy information
        # -----------------------------------------
        pregnancy_records = {}

        for _, pregnancy in pregnancies.iterrows():

            ben_id = pregnancy["beneficiary_id"]

            record = {
                "week": pregnancy["week"],
                "expected_delivery": pregnancy["exp_dd"],
                "delivery_date": pregnancy["dd"],
                "status": pregnancy["pregnancy_status"],
                "vacs_taken": decode_json(
                    pregnancy["vacs_taken"]
                ),
                "vacs_due": decode_json(
                    pregnancy["vac_due"]
                ),
                "next_vac_n_due": decode_json(
                    pregnancy["next_vac_n_due"]
                )
            }

            pregnancy_records.setdefault(
                ben_id, []
            ).append(record)

        # -----------------------------------------
        # 8. Aggregate visits
        # -----------------------------------------
        visit_records = {}

        for _, visit in visits.iterrows():

            ben_id = visit["beneficiary_id"]

            record = {
                "visit_id": visit["visit_id"],
                "visit_type": visit["visit_type"],
                "due_date": visit["due_date"],
                "visit_ts": visit["visit_ts"],
                "voice": visit["voice"],
                "note": visit["note"],
                "flag": visit["flag"]
            }

            visit_records.setdefault(
                ben_id, []
            ).append(record)

        # -----------------------------------------
        # 9. Build beneficiary-wise DataFrame
        # -----------------------------------------
        output = []

        for _, home in homes.iterrows():

            ben_id = home["beneficiary_id"]

            child_list = child_records.get(ben_id, [])
            pregnancy_list = pregnancy_records.get(ben_id, [])
            beneficiary_visits = visit_records.get(ben_id, [])

            # If no visits, preserve beneficiary profile.
            if not beneficiary_visits:
                beneficiary_visits = [None]

            for visit in beneficiary_visits:

                output.append({

                    # Household profile
                    "beneficiary_id": ben_id,
                    "address": home["address"],
                    "home_status": home["home_status"],

                    # Children
                    "total_children": len(child_list),
                    "children": child_list,

                    # Pregnancy
                    "total_pregnancies": len(pregnancy_list),
                    "pregnancies": pregnancy_list,

                    # Visit history
                    "visit_id": (
                        visit["visit_id"] if visit else None
                    ),
                    "visit_type": (
                        visit["visit_type"] if visit else None
                    ),
                    "due_date": (
                        visit["due_date"] if visit else None
                    ),
                    "visit_ts": (
                        visit["visit_ts"] if visit else None
                    ),
                    "voice": (
                        visit["voice"] if visit else None
                    ),
                    "note": (
                        visit["note"] if visit else None
                    ),
                    "flag": (
                        visit["flag"] if visit else None
                    )
                })

        df = pd.DataFrame(output)

        # -----------------------------------------
        # 10. Apply filters
        # -----------------------------------------
        if beneficiary_id:
            df = df[
                df["beneficiary_id"].astype(str)
                == str(beneficiary_id)
            ]

        if status:
            df = df[
                df["home_status"].astype(str).str.upper()
                == str(status).upper()
            ]

        # Date filters apply to visit timestamps.
        if start_date or end_date:

            def convert_date(value):
                try:
                    return pd.to_datetime(
                        value,
                        format="%d-%m-%Y",
                        errors="coerce"
                    )
                except (ValueError, TypeError):
                    return pd.NaT

            visit_dates = df["visit_ts"].apply(convert_date)

            if start_date:
                start = pd.to_datetime(
                    start_date,
                    format="%d-%m-%Y"
                )

                df = df[
                    visit_dates.isna() | (visit_dates >= start)
                ]

            if end_date:
                end = pd.to_datetime(
                    end_date,
                    format="%d-%m-%Y"
                )

                df = df[
                    visit_dates.isna() | (visit_dates <= end)
                ]

        # -----------------------------------------
        # 11. Sort and reset index
        # -----------------------------------------
        df = df.sort_values(
            by=["beneficiary_id", "visit_ts"],
            ascending=[True, True],
            na_position="last"
        ).reset_index(drop=True)

        return df

    except Exception as e:
        print("get_beneficiary_history_df:", e)
        return pd.DataFrame()

def get_all_logins():
    try:
        conn=get_conn()
        df = pd.read_sql("SELECT mobile, password FROM asha_workers", conn)
        return df
    except Exception as e:
        print("get_all_logins: ",e)

def login(mobile, password):
    try:
        conn = get_conn()
        row = conn.execute(
            "SELECT * FROM asha_workers WHERE mobile=?",
            (mobile,),
        ).fetchone()
        if row is None:
            return {"success": False, "message": "Mobile number not found", "user": None}

        # Matches the schema: (id, name, mobile, email, dob, address, password)
        if row[6] == password:
            user = {
                "id": row[0],
                "name": row[1],
                "mobile": row[2],
                "email": row[3],
                "dob": row[4],
                "address": row[5],
            }
            return {"success": True, "message": "Login successful", "user": user}
        else:
            return {"success": False, "message": "Invalid password", "user": None}

    except Exception as e:
        return {"success": False, "message": f"Login error: {e}", "user": None}

def get_asha_worker_profile(worker_id):

    conn = None

    try:
        conn = get_conn()

        query = """
            SELECT
                id AS worker_id,
                name,
                mobile,
                email,
                dob,
                address
            FROM asha_workers
        """

        params = ()

        if worker_id:
            query += " WHERE id = ?"
            params = (worker_id,)

        query += " ORDER BY name"

        df = pd.read_sql_query(
            query,
            conn,
            params=params
        )

        return df

    except Exception as e:
        print("get_asha_worker_profile:", e)
        return pd.DataFrame()

def get_mother_profile(beneficiary_id):
    try:
        conn = get_conn()
        row = conn.execute(
            """
            SELECT
                beneficiary_id,
                week,
                exp_dd,
                dd,
                status,
                vacs_taken,
                vac_due,
                next_vac_n_due,
                mother_name,
                age,
                dob,
                mobile,
                weight,
                blood_grp
            FROM pregnancies
            WHERE beneficiary_id = ?
            """,
            (beneficiary_id,),
        ).fetchone()

        if row is None:
            return None

        return {
            "beneficiary_id": row[0],
            "week": row[1],
            "exp_dd": row[2],
            "dd": row[3],
            "status": row[4],
            "vacs_taken": row[5],
            "vac_due": row[6],
            "next_vac_n_due": row[7],
            "mother_name": row[8],
            "age": row[9],
            "dob": row[10],
            "mobile": row[11],
            "weight": row[12],
            "blood_grp": row[13],
        }

    except Exception as e:
        print(f"Error fetching mother profile for {beneficiary_id}: {e}")
        return None

def get_child_profile(beneficiary_id=None, child_name=None):
    try:
        conn = get_conn()

        if beneficiary_id and child_name:
            row = conn.execute(
                """
                SELECT
                    beneficiary_id,
                    child_name,
                    dob,
                    age,
                    gender,
                    weight,
                    vacs_taken,
                    vacs_due,
                    next_vac_n_due,
                    next_visit,
                    father_name,
                    mother_name,
                    blood_grp
                FROM children
                WHERE beneficiary_id = ? AND child_name = ?
                """,
                (beneficiary_id, child_name),
            ).fetchone()
        elif beneficiary_id:
            row = conn.execute(
                """
                SELECT
                    beneficiary_id,
                    child_name,
                    dob,
                    age,
                    gender,
                    weight,
                    vacs_taken,
                    vacs_due,
                    next_vac_n_due,
                    next_visit,
                    father_name,
                    mother_name,
                    blood_grp
                FROM children
                WHERE beneficiary_id = ?
                """,
                (beneficiary_id,),
            ).fetchone()
        elif child_name:
            row = conn.execute(
                """
                SELECT
                    beneficiary_id,
                    child_name,
                    dob,
                    age,
                    gender,
                    weight,
                    vacs_taken,
                    vacs_due,
                    next_vac_n_due,
                    next_visit,
                    father_name,
                    mother_name,
                    blood_grp
                FROM children
                WHERE child_name = ?
                """,
                (child_name,),
            ).fetchone()
        else:
            return None

        if row is None:
            return None

        return {
            "beneficiary_id": row[0],
            "child_name": row[1],
            "dob": row[2],
            "age": row[3],
            "gender": row[4],
            "weight": row[5],
            "vacs_taken": row[6],
            "vacs_due": row[7],
            "next_vac_n_due": row[8],
            "next_visit": row[9],
            "father_name": row[10],
            "mother_name": row[11],
            "blood_grp": row[12],
        }

    except Exception as e:
        print(f"Error fetching child profile: {e}")
        return None

def get_all_mother_list():
    try:
        conn = get_conn()
        rows = conn.execute(
            """
            SELECT
                beneficiary_id,
                mother_name
            FROM pregnancies
            """
        ).fetchall()

        return [
            {
                "beneficiary_id": row[0],
                "mother_name": row[1],
            }
            for row in rows
        ]

    except Exception as e:
        print(f"Error fetching mother list: {e}")
        return []

def get_all_children_list():
    try:
        conn = get_conn()
        rows = conn.execute(
            """
            SELECT
                beneficiary_id,
                child_name
            FROM children
            """
        ).fetchall()

        return [
            {
                "beneficiary_id": row[0],
                "child_name": row[1],
            }
            for row in rows
        ]

    except Exception as e:
        print(f"Error fetching children list: {e}")
        return []




def _sakhi_decode_json(value):
    """
    Safely decode JSON stored in SQLite.

    Returns:
        dict if valid JSON dictionary.
        {} if empty, NULL, invalid, or not a dictionary.
    """

    if isinstance(value, dict):
        return value

    if value is None or str(value).strip().upper() in (
        "", "NONE", "NULL", "N/A"
    ):
        return {}

    try:
        result = json.loads(value)

        if isinstance(result, dict):
            return result

        return {}

    except (json.JSONDecodeError, TypeError, ValueError):
        return {}

def update_vac(
    beneficiary_id,
    vaccine,
    administered_date,
    mode="child",
    child_name=None,
    pregnancy_rowid=None
):
    """
    Record an actually administered vaccine and recalculate
    vaccination status.

    Parameters:
        beneficiary_id: Beneficiary ID.
        vaccine: Exact vaccine name, e.g. BCG, Td-1, Td-2.
        administered_date: Actual administration date (DD-MM-YYYY).
        mode: 'child' or 'mother'.
        child_name: Required in child mode.
        pregnancy_rowid: Optional SQLite rowid to identify a
                         particular pregnancy when needed.

    Returns:
        Dictionary containing operation status and updated records.
    """

    conn = None

    try:
        # -----------------------------------------
        # 1. Validate inputs
        # -----------------------------------------
        if not beneficiary_id or str(beneficiary_id).strip().upper() in (
            "NONE", "NULL", ""
        ):
            raise ValueError("Beneficiary ID is required.")

        if not vaccine or not str(vaccine).strip():
            raise ValueError("Vaccine name is required.")

        vaccine = str(vaccine).strip()

        if not administered_date:
            raise ValueError("Administration date is required.")

        administered_dt = datetime.strptime(
            administered_date, "%d-%m-%Y"
        ).date()

        if administered_dt > date.today():
            raise ValueError(
                "Administration date cannot be in the future."
            )

        mode = mode.lower().strip()

        if mode not in ("child", "mother"):
            raise ValueError("Mode must be 'child' or 'mother'.")

        conn = get_conn()

        # =========================================
        # CHILD VACCINATION UPDATE
        # =========================================
        if mode == "child":

            if not child_name:
                raise ValueError(
                    "Child name is required in child mode."
                )

            # -------------------------------------
            # 2. Retrieve child
            # -------------------------------------
            child = conn.execute("""
                SELECT
                    beneficiary_id,
                    child_name,
                    dob,
                    vacs_taken,
                    vacs_due,
                    next_vac_n_due
                FROM children
                WHERE beneficiary_id = ?
                  AND child_name = ?
            """, (beneficiary_id, child_name)).fetchone()

            if not child:
                raise ValueError("Child record not found.")

            # -------------------------------------
            # 3. Decode existing vaccination records
            # -------------------------------------
            taken = _sakhi_decode_json(child[3])

            # Record actual administration.
            # If the vaccine already exists, this updates its date.
            taken[vaccine] = administered_dt.strftime("%d-%m-%Y")

            # -------------------------------------
            # 4. Recalculate vaccination schedule
            # -------------------------------------
            result = calc_vacs(
                dob=child[2],
                administered=taken,
                mode="child"
            )

            if not isinstance(result, dict):
                raise ValueError(
                    "Child vaccination calculation failed."
                )

            # -------------------------------------
            # 5. Update child database record
            # -------------------------------------
            conn.execute("""
                UPDATE children
                SET
                    vacs_taken = ?,
                    vacs_due = ?,
                    next_vac_n_due = ?
                WHERE beneficiary_id = ?
                  AND child_name = ?
            """, (
                json.dumps(result["vacs_taken"]),
                json.dumps(result["vacs_due"]),
                json.dumps(result["next_vac_n_due"]),
                beneficiary_id,
                child_name
            ))

            conn.commit()

            return {
                "res": True,
                "mode": "child",
                "beneficiary_id": beneficiary_id,
                "child_name": child_name,
                "vaccine": vaccine,
                "administered_date": administered_date,
                "vacs_taken": result["vacs_taken"],
                "vacs_due": result["vacs_due"],
                "next_vac_n_due": result["next_vac_n_due"],
                "message": "Child vaccination record updated successfully."
            }

        # =========================================
        # MATERNAL VACCINATION UPDATE
        # =========================================
        elif mode == "mother":

            # -------------------------------------
            # 2. Retrieve pregnancy records
            # -------------------------------------
            pregnancy_rows = conn.execute("""
                SELECT
                    rowid,
                    beneficiary_id,
                    week,
                    dd,
                    status,
                    vacs_taken,
                    vac_due,
                    next_vac_n_due
                FROM pregnancies
                WHERE beneficiary_id = ?
                ORDER BY rowid DESC
            """, (beneficiary_id,)).fetchall()

            if not pregnancy_rows:
                raise ValueError("Pregnancy record not found.")

            if pregnancy_rowid is not None:

                matches = [
                    row for row in pregnancy_rows
                    if row[0] == pregnancy_rowid
                ]

                if not matches:
                    raise ValueError("Specified pregnancy record not found.")

                pregnancy = matches[0]

            else:

                active_rows = [
                    row for row in pregnancy_rows
                    if str(row[4] or "").strip().upper() != "COMPLETED"
                ]

                if len(active_rows) > 1:
                    raise ValueError(
                        "Multiple active pregnancies found. "
                        "Provide pregnancy_rowid."
                    )

                if len(active_rows) == 1:
                    pregnancy = active_rows[0]

                elif len(pregnancy_rows) == 1:
                    pregnancy = pregnancy_rows[0]

                else:
                    raise ValueError(
                        "No unique pregnancy found. "
                        "Provide pregnancy_rowid."
                    )

            current_rowid = pregnancy[0]
            pregnancy_week = pregnancy[2]
            delivery_date = pregnancy[3]

            if pregnancy_week is None:
                raise ValueError(
                    "Current pregnancy week is missing."
                )

            # -------------------------------------
            # 3. Decode current maternal records
            # -------------------------------------
            taken = _sakhi_decode_json(pregnancy[5])

            # Record actual administration.
            taken[vaccine] = administered_dt.strftime("%d-%m-%Y")

            # -------------------------------------
            # 4. Retrieve historical Td/TT doses
            # -------------------------------------
            historical_dates = []

            for old_pregnancy in pregnancy_rows:

                old_rowid = old_pregnancy[0]

                if old_rowid == current_rowid:
                    continue

                old_status = str(
                    old_pregnancy[4] or ""
                ).strip().upper()

                # Use completed pregnancies as historical records.
                if old_status != "COMPLETED":
                    continue

                old_taken = _sakhi_decode_json(
                    old_pregnancy[5]
                )

                for old_vaccine, old_date in old_taken.items():

                    if (
                        old_vaccine.upper().startswith(("TD", "TT"))
                        and old_date
                    ):
                        historical_dates.append(old_date)

            # -------------------------------------
            # 5. Recalculate maternal vaccines
            # -------------------------------------
            result = calc_vacs(
                administered=taken,
                pregnancy_week=int(pregnancy_week),
                delivery_date=delivery_date,
                previous_td_dates=historical_dates,
                mode="mother"
            )

            if not isinstance(result, dict):
                raise ValueError(
                    "Maternal vaccination calculation failed."
                )

            # -------------------------------------
            # 6. Update pregnancy database record
            # -------------------------------------
            conn.execute("""
                UPDATE pregnancies
                SET
                    vacs_taken = ?,
                    vac_due = ?,
                    next_vac_n_due = ?
                WHERE rowid = ?
            """, (
                json.dumps(result["vacs_taken"]),
                json.dumps(result["vacs_due"]),
                json.dumps(result["next_vac_n_due"]),
                current_rowid
            ))

            conn.commit()

            return {
                "res": True,
                "mode": "mother",
                "beneficiary_id": beneficiary_id,
                "vaccine": vaccine,
                "administered_date": administered_date,
                "vacs_taken": result["vacs_taken"],
                "vacs_due": result["vacs_due"],
                "next_vac_n_due": result["next_vac_n_due"],
                "message": "Maternal vaccination record updated successfully."
            }

    except Exception as e:

        if conn:
            conn.rollback()

        print("update_vac:", e)

        return {
            "res": False,
            "message": str(e)
        }


