package postgres

import (
	"context"
	"errors"
	"fmt"
	"time"

	"github.com/jackc/pgx/v5"

	"github.com/erwinsskoffi/press_backend/internal/domain/pressing"
	"github.com/erwinsskoffi/press_backend/internal/platform/dbtx"
)

// ExpenseRepo (soft-delete, ADR A14).
type ExpenseRepo struct{}

const expenseCols = `id, label, category, amount_fcfa, method, expense_date, note, created_at`

func scanExpense(row pgx.Row) (*pressing.ExpenseRecord, error) {
	e := &pressing.ExpenseRecord{}
	var d time.Time
	var createdAt time.Time
	if err := row.Scan(&e.ID, &e.Label, &e.Category, &e.AmountFCFA, &e.Method, &d, &e.Note, &createdAt); err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			return nil, nil
		}
		return nil, err
	}
	e.Date = d.Format("2006-01-02")
	e.CreatedAt = createdAt.UTC().Format(time.RFC3339)
	return e, nil
}

func (ExpenseRepo) List(ctx context.Context, q dbtx.Querier, from, to string, limit, offset int) ([]*pressing.ExpenseRecord, int, error) {
	where := " WHERE deleted_at IS NULL"
	args := []any{}
	if from != "" {
		where += fmt.Sprintf(" AND expense_date >= $%d", len(args)+1)
		args = append(args, from)
	}
	if to != "" {
		where += fmt.Sprintf(" AND expense_date <= $%d", len(args)+1)
		args = append(args, to)
	}
	var total int
	if err := q.QueryRow(ctx, "SELECT count(*) FROM expenses"+where, args...).Scan(&total); err != nil {
		return nil, 0, err
	}
	sql := "SELECT " + expenseCols + " FROM expenses" + where +
		fmt.Sprintf(" ORDER BY expense_date DESC, created_at DESC LIMIT %d OFFSET %d", limit, offset)
	rows, err := q.Query(ctx, sql, args...)
	if err != nil {
		return nil, 0, err
	}
	defer rows.Close()
	out := []*pressing.ExpenseRecord{}
	for rows.Next() {
		e, err := scanExpense(rows)
		if err != nil {
			return nil, 0, err
		}
		out = append(out, e)
	}
	return out, total, rows.Err()
}

func (r ExpenseRepo) Get(ctx context.Context, q dbtx.Querier, id string) (*pressing.ExpenseRecord, error) {
	return scanExpense(q.QueryRow(ctx, "SELECT "+expenseCols+" FROM expenses WHERE id=$1 AND deleted_at IS NULL", id))
}

func (ExpenseRepo) Create(ctx context.Context, q dbtx.Querier, e *pressing.ExpenseRecord) error {
	_, err := q.Exec(ctx, `
		INSERT INTO expenses (id, label, category, amount_fcfa, method, expense_date, note)
		VALUES ($1,$2,$3,$4,$5,$6,$7)`,
		e.ID, e.Label, e.Category, e.AmountFCFA, e.Method, e.Date, e.Note)
	return err
}

func (ExpenseRepo) SoftDelete(ctx context.Context, q dbtx.Querier, id string) error {
	tag, err := q.Exec(ctx, `UPDATE expenses SET deleted_at=now(), revision=nextval('change_seq') WHERE id=$1 AND deleted_at IS NULL`, id)
	if err != nil {
		return err
	}
	if tag.RowsAffected() == 0 {
		return fmt.Errorf("dépense introuvable")
	}
	return nil
}

// ZoneRepo.
type ZoneRepo struct{}

func scanZone(row pgx.Row) (*pressing.DeliveryZone, error) {
	z := &pressing.DeliveryZone{}
	var createdAt, updatedAt time.Time
	if err := row.Scan(&z.ID, &z.Commune, &z.FeeFCFA, &z.PickupFeeFCFA, &z.Active, &createdAt, &updatedAt); err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			return nil, nil
		}
		return nil, err
	}
	z.CreatedAt = createdAt.UTC().Format(time.RFC3339)
	z.UpdatedAt = updatedAt.UTC().Format(time.RFC3339)
	return z, nil
}

func (ZoneRepo) List(ctx context.Context, q dbtx.Querier) ([]*pressing.DeliveryZone, error) {
	rows, err := q.Query(ctx, `
		SELECT id, commune, fee_fcfa, pickup_fee_fcfa, active, created_at, updated_at
		FROM delivery_zones ORDER BY commune`)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	out := []*pressing.DeliveryZone{}
	for rows.Next() {
		z, err := scanZone(rows)
		if err != nil {
			return nil, err
		}
		out = append(out, z)
	}
	return out, rows.Err()
}

func (r ZoneRepo) Get(ctx context.Context, q dbtx.Querier, id string) (*pressing.DeliveryZone, error) {
	return scanZone(q.QueryRow(ctx, `
		SELECT id, commune, fee_fcfa, pickup_fee_fcfa, active, created_at, updated_at
		FROM delivery_zones WHERE id=$1`, id))
}

func (ZoneRepo) Upsert(ctx context.Context, q dbtx.Querier, z *pressing.DeliveryZone) error {
	_, err := q.Exec(ctx, `
		INSERT INTO delivery_zones (id, commune, fee_fcfa, pickup_fee_fcfa, active)
		VALUES ($1,$2,$3,$4,$5)
		ON CONFLICT (id) DO UPDATE SET
		  commune=EXCLUDED.commune, fee_fcfa=EXCLUDED.fee_fcfa, pickup_fee_fcfa=EXCLUDED.pickup_fee_fcfa,
		  active=EXCLUDED.active, revision=nextval('change_seq'), updated_at=now()`,
		z.ID, z.Commune, z.FeeFCFA, z.PickupFeeFCFA, z.Active)
	return err
}

func (ZoneRepo) Delete(ctx context.Context, q dbtx.Querier, id string) error {
	tag, err := q.Exec(ctx, `DELETE FROM delivery_zones WHERE id=$1`, id)
	if err != nil {
		return err
	}
	if tag.RowsAffected() == 0 {
		return fmt.Errorf("zone introuvable")
	}
	return err
}

// LogisticsRepo.
type LogisticsRepo struct{}

const logisticsCols = `id, type, status, client_id, client_name, client_phone, commune, address_detail,
	order_id, ticket_number, scheduled_date, time_slot, courier_name, courier_phone,
	estimated_pieces, fee_fcfa, notes, created_at, updated_at`

func scanTask(row pgx.Row) (*pressing.LogisticsTask, error) {
	t := &pressing.LogisticsTask{}
	var scheduled time.Time
	var createdAt, updatedAt time.Time
	if err := row.Scan(&t.ID, &t.Type, &t.Status, &t.ClientID, &t.ClientName, &t.ClientPhone,
		&t.Commune, &t.AddressDetail, &t.OrderID, &t.TicketNumber, &scheduled, &t.TimeSlot,
		&t.CourierName, &t.CourierPhone, &t.EstimatedPieces, &t.FeeFCFA, &t.Notes,
		&createdAt, &updatedAt); err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			return nil, nil
		}
		return nil, err
	}
	t.ScheduledDate = scheduled.Format("2006-01-02")
	t.CreatedAt = createdAt.UTC().Format(time.RFC3339)
	t.UpdatedAt = updatedAt.UTC().Format(time.RFC3339)
	return t, nil
}

func (LogisticsRepo) List(ctx context.Context, q dbtx.Querier, status, typ, date string) ([]*pressing.LogisticsTask, error) {
	where := " WHERE TRUE"
	args := []any{}
	if status != "" {
		where += fmt.Sprintf(" AND status = $%d", len(args)+1)
		args = append(args, status)
	}
	if typ != "" {
		where += fmt.Sprintf(" AND type = $%d", len(args)+1)
		args = append(args, typ)
	}
	if date != "" {
		where += fmt.Sprintf(" AND scheduled_date = $%d", len(args)+1)
		args = append(args, date)
	}
	sql := "SELECT " + logisticsCols + " FROM logistics_tasks" + where + " ORDER BY scheduled_date, created_at DESC"
	rows, err := q.Query(ctx, sql, args...)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	out := []*pressing.LogisticsTask{}
	for rows.Next() {
		t, err := scanTask(rows)
		if err != nil {
			return nil, err
		}
		out = append(out, t)
	}
	return out, rows.Err()
}

func (r LogisticsRepo) Get(ctx context.Context, q dbtx.Querier, id string) (*pressing.LogisticsTask, error) {
	return scanTask(q.QueryRow(ctx, "SELECT "+logisticsCols+" FROM logistics_tasks WHERE id=$1", id))
}

func (LogisticsRepo) Upsert(ctx context.Context, q dbtx.Querier, t *pressing.LogisticsTask) error {
	_, err := q.Exec(ctx, `
		INSERT INTO logistics_tasks (id, type, status, client_id, client_name, client_phone, commune,
		  address_detail, order_id, ticket_number, scheduled_date, time_slot, courier_name, courier_phone,
		  estimated_pieces, fee_fcfa, notes)
		VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17)
		ON CONFLICT (id) DO UPDATE SET
		  type=EXCLUDED.type, status=EXCLUDED.status, client_id=EXCLUDED.client_id,
		  client_name=EXCLUDED.client_name, client_phone=EXCLUDED.client_phone, commune=EXCLUDED.commune,
		  address_detail=EXCLUDED.address_detail, order_id=EXCLUDED.order_id, ticket_number=EXCLUDED.ticket_number,
		  scheduled_date=EXCLUDED.scheduled_date, time_slot=EXCLUDED.time_slot, courier_name=EXCLUDED.courier_name,
		  courier_phone=EXCLUDED.courier_phone, estimated_pieces=EXCLUDED.estimated_pieces,
		  fee_fcfa=EXCLUDED.fee_fcfa, notes=EXCLUDED.notes, revision=nextval('change_seq'), updated_at=now()`,
		t.ID, t.Type, t.Status, t.ClientID, t.ClientName, t.ClientPhone, t.Commune,
		t.AddressDetail, t.OrderID, t.TicketNumber, t.ScheduledDate, t.TimeSlot, t.CourierName,
		t.CourierPhone, t.EstimatedPieces, t.FeeFCFA, t.Notes)
	return err
}

// UpdateStatus applique le statut et, si une livraison liée est effectuée,
// marque la commande `livre` DANS LA MÊME TRANSACTION (corrige E2).
func (LogisticsRepo) UpdateStatus(ctx context.Context, q dbtx.Querier, id string, status pressing.LogisticsStatus) (*pressing.LogisticsTask, error) {
	tag, err := q.Exec(ctx, `UPDATE logistics_tasks SET status=$1, revision=nextval('change_seq'), updated_at=now() WHERE id=$2`, status, id)
	if err != nil {
		return nil, err
	}
	if tag.RowsAffected() == 0 {
		return nil, fmt.Errorf("tâche introuvable")
	}
	task, err := (LogisticsRepo{}).Get(ctx, q, id)
	if err != nil {
		return nil, err
	}
	if task != nil && status == pressing.LogisticsEffectue && task.Type == pressing.LogisticsLivraison && task.OrderID != nil {
		tag, err := q.Exec(ctx, `
			UPDATE orders SET status='livre', delivered_at=now(), revision=nextval('change_seq'), updated_at=now()
			WHERE id=$1 AND voided_at IS NULL AND status <> 'livre'`, *task.OrderID)
		if err != nil {
			return nil, err
		}
		_ = tag
	}
	return task, nil
}

func (LogisticsRepo) Delete(ctx context.Context, q dbtx.Querier, id string) error {
	tag, err := q.Exec(ctx, `DELETE FROM logistics_tasks WHERE id=$1`, id)
	if err != nil {
		return err
	}
	if tag.RowsAffected() == 0 {
		return fmt.Errorf("tâche introuvable")
	}
	return nil
}

// InventoryRepo.
type InventoryRepo struct{}

const inventoryCols = `id, name, sku, category, activity_scope, unit, quantity, min_threshold, unit_cost_fcfa, supplier, notes, archived_at, updated_at`

func scanInventoryItem(row pgx.Row) (*pressing.InventoryItem, error) {
	i := &pressing.InventoryItem{}
	var archivedAt *time.Time
	var updatedAt time.Time
	if err := row.Scan(&i.ID, &i.Name, &i.SKU, &i.Category, &i.ActivityScope, &i.Unit,
		&i.Quantity, &i.MinThreshold, &i.UnitCostFCFA, &i.Supplier, &i.Notes, &archivedAt, &updatedAt); err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			return nil, nil
		}
		return nil, err
	}
	i.Archived = archivedAt != nil
	i.UpdatedAt = updatedAt.UTC().Format(time.RFC3339)
	return i, nil
}

func (InventoryRepo) List(ctx context.Context, q dbtx.Querier) ([]*pressing.InventoryItem, error) {
	rows, err := q.Query(ctx, "SELECT "+inventoryCols+" FROM inventory_items WHERE archived_at IS NULL ORDER BY category, name")
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	out := []*pressing.InventoryItem{}
	for rows.Next() {
		i, err := scanInventoryItem(rows)
		if err != nil {
			return nil, err
		}
		out = append(out, i)
	}
	return out, rows.Err()
}

func (r InventoryRepo) Get(ctx context.Context, q dbtx.Querier, id string) (*pressing.InventoryItem, error) {
	return scanInventoryItem(q.QueryRow(ctx, "SELECT "+inventoryCols+" FROM inventory_items WHERE id=$1", id))
}

func (InventoryRepo) Upsert(ctx context.Context, q dbtx.Querier, i *pressing.InventoryItem) error {
	_, err := q.Exec(ctx, `
		INSERT INTO inventory_items (id, name, sku, category, activity_scope, unit, quantity, min_threshold, unit_cost_fcfa, supplier, notes)
		VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)
		ON CONFLICT (id) DO UPDATE SET
		  name=EXCLUDED.name, sku=EXCLUDED.sku, category=EXCLUDED.category, activity_scope=EXCLUDED.activity_scope,
		  unit=EXCLUDED.unit, quantity=EXCLUDED.quantity, min_threshold=EXCLUDED.min_threshold,
		  unit_cost_fcfa=EXCLUDED.unit_cost_fcfa, supplier=EXCLUDED.supplier, notes=EXCLUDED.notes,
		  revision=nextval('change_seq'), updated_at=now()`,
		i.ID, i.Name, i.SKU, i.Category, i.ActivityScope, i.Unit, i.Quantity, i.MinThreshold,
		i.UnitCostFCFA, i.Supplier, i.Notes)
	return err
}

func (InventoryRepo) Archive(ctx context.Context, q dbtx.Querier, id string) error {
	tag, err := q.Exec(ctx, `UPDATE inventory_items SET archived_at=now(), revision=nextval('change_seq'), updated_at=now() WHERE id=$1 AND archived_at IS NULL`, id)
	if err != nil {
		return err
	}
	if tag.RowsAffected() == 0 {
		return fmt.Errorf("article introuvable")
	}
	return nil
}

// LockForUpdate verrouille la ligne de l'article pour le mouvement (A16).
func (InventoryRepo) LockForUpdate(ctx context.Context, q dbtx.Querier, id string) (*pressing.InventoryItem, error) {
	return scanInventoryItem(q.QueryRow(ctx, "SELECT "+inventoryCols+" FROM inventory_items WHERE id=$1 FOR UPDATE", id))
}

func (InventoryRepo) SetQuantity(ctx context.Context, q dbtx.Querier, id string, qty float64, unitCost *int64) error {
	sql := `UPDATE inventory_items SET quantity=$1, revision=nextval('change_seq'), updated_at=now()`
	args := []any{qty, id}
	if unitCost != nil {
		sql = `UPDATE inventory_items SET quantity=$1, unit_cost_fcfa=$2, revision=nextval('change_seq'), updated_at=now()`
		args = []any{qty, *unitCost, id}
	}
	_, err := q.Exec(ctx, sql+" WHERE id=$"+fmt.Sprint(len(args)), args...)
	return err
}

func (InventoryRepo) AddMovement(ctx context.Context, q dbtx.Querier, m *pressing.InventoryMovement) error {
	_, err := q.Exec(ctx, `
		INSERT INTO inventory_movements (id, item_id, item_name, type, quantity_delta, previous_qty, new_qty,
		  unit, unit_cost_fcfa, total_cost_fcfa, reason)
		VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)`,
		m.ID, m.ItemID, m.ItemName, m.Type, m.QuantityDelta, m.PreviousQty, m.NewQty,
		m.Unit, m.UnitCostFCFA, m.TotalCostFCFA, m.Reason)
	return err
}

func (InventoryRepo) ListMovements(ctx context.Context, q dbtx.Querier, itemID string, limit int) ([]*pressing.InventoryMovement, error) {
	sql := `SELECT id, item_id, item_name, type, quantity_delta, previous_qty, new_qty, unit, unit_cost_fcfa, total_cost_fcfa, reason, created_at
		FROM inventory_movements`
	args := []any{}
	if itemID != "" {
		sql += " WHERE item_id=$1"
		args = append(args, itemID)
	}
	sql += fmt.Sprintf(" ORDER BY created_at DESC LIMIT %d", limit)
	rows, err := q.Query(ctx, sql, args...)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	out := []*pressing.InventoryMovement{}
	for rows.Next() {
		m := &pressing.InventoryMovement{}
		var createdAt time.Time
		if err := rows.Scan(&m.ID, &m.ItemID, &m.ItemName, &m.Type, &m.QuantityDelta, &m.PreviousQty,
			&m.NewQty, &m.Unit, &m.UnitCostFCFA, &m.TotalCostFCFA, &m.Reason, &createdAt); err != nil {
			return nil, err
		}
		m.CreatedAt = createdAt.UTC().Format(time.RFC3339)
		out = append(out, m)
	}
	return out, rows.Err()
}

// PaymentListing : paiements paginés pour la caisse / bootstrap.
type ReportRepo struct{}

func (ReportRepo) ListPayments(ctx context.Context, q dbtx.Querier, from, to string, limit int) ([]*pressing.PaymentRecord, error) {
	sql := `SELECT id, order_id, ticket_number, client_name, amount_fcfa, method, paid_at, type, kind
		FROM payments WHERE TRUE`
	args := []any{}
	if from != "" {
		sql += fmt.Sprintf(" AND paid_at >= $%d::date", len(args)+1)
		args = append(args, from)
	}
	if to != "" {
		sql += fmt.Sprintf(" AND paid_at < ($%d::date + interval '1 day')", len(args)+1)
		args = append(args, to)
	}
	sql += fmt.Sprintf(" ORDER BY paid_at DESC LIMIT %d", limit)
	rows, err := q.Query(ctx, sql, args...)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	out := []*pressing.PaymentRecord{}
	for rows.Next() {
		p := &pressing.PaymentRecord{}
		var paidAt time.Time
		if err := rows.Scan(&p.ID, &p.OrderID, &p.TicketNumber, &p.ClientName, &p.AmountFCFA, &p.Method, &paidAt, &p.Type, &p.Kind); err != nil {
			return nil, err
		}
		p.PaidAt = paidAt.UTC().Format(time.RFC3339)
		out = append(out, p)
	}
	return out, rows.Err()
}

func (r ReportRepo) DailyZ(ctx context.Context, q dbtx.Querier, date string) (*pressing.DailyZ, error) {
	z := &pressing.DailyZ{
		Date:               date,
		RevenueByMethod:    map[string]int64{},
		ExpensesByCategory: map[string]int64{},
	}
	rows, err := q.Query(ctx, `
		SELECT method, kind, COALESCE(SUM(amount_fcfa),0)
		FROM payments WHERE paid_at >= $1::date AND paid_at < ($1::date + interval '1 day')
		GROUP BY method, kind`, date)
	if err != nil {
		return nil, err
	}
	for rows.Next() {
		var method, kind string
		var sum int64
		if err := rows.Scan(&method, &kind, &sum); err != nil {
			rows.Close()
			return nil, err
		}
		z.RevenueTotal += sum
		z.RevenueByMethod[method] += sum
		if kind == "prepaid_topup" {
			z.RevenuePrepaidTopup += sum
		} else {
			z.RevenueOrder += sum
		}
	}
	rows.Close()

	rows2, err := q.Query(ctx, `
		SELECT COALESCE(category,''), COALESCE(SUM(amount_fcfa),0)
		FROM expenses WHERE deleted_at IS NULL AND expense_date = $1::date
		GROUP BY category`, date)
	if err != nil {
		return nil, err
	}
	for rows2.Next() {
		var cat string
		var sum int64
		if err := rows2.Scan(&cat, &sum); err != nil {
			rows2.Close()
			return nil, err
		}
		z.ExpensesTotal += sum
		z.ExpensesByCategory[cat] = sum
	}
	rows2.Close()

	if err := q.QueryRow(ctx, `
		SELECT count(*) FROM orders WHERE drop_off_date = $1::date AND voided_at IS NULL`, date).Scan(&z.OrdersCount); err != nil {
		return nil, err
	}
	z.NetCash = z.RevenueTotal - z.ExpensesTotal
	return z, nil
}

func (r ReportRepo) Monthly(ctx context.Context, q dbtx.Querier, month string) (*pressing.MonthlyReport, error) {
	m := &pressing.MonthlyReport{Month: month, Days: []pressing.MonthlyDay{}}
	dayRevenue := map[string]int64{}
	rows, err := q.Query(ctx, `
		SELECT to_char(paid_at, 'YYYY-MM-DD'), COALESCE(SUM(amount_fcfa),0)
		FROM payments
		WHERE to_char(paid_at,'YYYY-MM') = $1
		GROUP BY 1 ORDER BY 1`, month)
	if err != nil {
		return nil, err
	}
	for rows.Next() {
		var d string
		var sum int64
		if err := rows.Scan(&d, &sum); err != nil {
			rows.Close()
			return nil, err
		}
		dayRevenue[d] += sum
		m.RevenueTotal += sum
	}
	rows.Close()

	rows2, err := q.Query(ctx, `
		SELECT kind, COALESCE(SUM(amount_fcfa),0) FROM payments
		WHERE to_char(paid_at,'YYYY-MM') = $1 GROUP BY kind`, month)
	if err != nil {
		return nil, err
	}
	for rows2.Next() {
		var kind string
		var sum int64
		if err := rows2.Scan(&kind, &sum); err != nil {
			rows2.Close()
			return nil, err
		}
		if kind == "prepaid_topup" {
			m.RevenuePrepaidTopup = sum
		} else {
			m.RevenueOrder = sum
		}
	}
	rows2.Close()

	dayExpenses := map[string]int64{}
	rows3, err := q.Query(ctx, `
		SELECT to_char(expense_date,'YYYY-MM-DD'), COALESCE(SUM(amount_fcfa),0)
		FROM expenses WHERE deleted_at IS NULL AND to_char(expense_date,'YYYY-MM') = $1
		GROUP BY 1 ORDER BY 1`, month)
	if err != nil {
		return nil, err
	}
	for rows3.Next() {
		var d string
		var sum int64
		if err := rows3.Scan(&d, &sum); err != nil {
			rows3.Close()
			return nil, err
		}
		dayExpenses[d] += sum
		m.ExpensesTotal += sum
	}
	rows3.Close()

	seen := map[string]bool{}
	for d := range dayRevenue {
		seen[d] = true
	}
	for d := range dayExpenses {
		seen[d] = true
	}
	for d := range seen {
		m.Days = append(m.Days, pressing.MonthlyDay{Date: d, Revenue: dayRevenue[d], Expenses: dayExpenses[d]})
	}
	for i := 0; i < len(m.Days); i++ {
		for j := i + 1; j < len(m.Days); j++ {
			if m.Days[j].Date < m.Days[i].Date {
				m.Days[i], m.Days[j] = m.Days[j], m.Days[i]
			}
		}
	}
	m.Net = m.RevenueTotal - m.ExpensesTotal
	return m, nil
}
