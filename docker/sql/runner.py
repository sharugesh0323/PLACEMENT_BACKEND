import sqlite3
import sys
import os

def run_sql():
    # Paths for SQL files
    schema_path = '/code/schema.sql'
    seed_path = '/code/seed.sql'
    solution_path = '/code/solution.sql'
    
    db = sqlite3.connect(':memory:')
    cursor = db.cursor()
    
    try:
        # Load schema (DDL)
        if os.path.exists(schema_path):
            with open(schema_path, 'r') as f:
                content = f.read().strip()
                if content:
                    cursor.executescript(content)
        
        # Load seed data (DML)
        if os.path.exists(seed_path):
            with open(seed_path, 'r') as f:
                content = f.read().strip()
                if content:
                    cursor.executescript(content)
        
        # Run student solution query
        if os.path.exists(solution_path):
            with open(solution_path, 'r') as f:
                query = f.read().strip()
                if not query:
                    return
                
                cursor.execute(query)
                
                # Check if it was a SELECT query
                if cursor.description:
                    # Get column names
                    columns = [description[0] for description in cursor.description]
                    # Get results
                    rows = cursor.fetchall()
                    
                    # Output format: CSV style for consistency in comparison
                    print("|".join(columns))
                    for row in rows:
                        print("|".join(map(str, row)))
                else:
                    # For non-select (UPDATE, INSERT, DELETE)
                    db.commit()
                    print(f"Query executed successfully. Rows affected: {cursor.rowcount}")
                    
    except sqlite3.Error as e:
        print(f"SQL Error: {e}", file=sys.stderr)
        sys.exit(1)
    except Exception as e:
        print(f"Execution Error: {e}", file=sys.stderr)
        sys.exit(1)
    finally:
        db.close()

if __name__ == "__main__":
    run_sql()
