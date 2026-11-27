package service

import (
	"context"
	"fmt"
	"time"

	"github.com/erwinsskoffi/press_backend/internal/domain/pressing"
	"github.com/erwinsskoffi/press_backend/internal/platform/dbtx"
)

// ZStore : agrégats caisse (implémenté par ReportRepo postgres).
type ZStore interface {
	DailyZ(ctx context.Context, q dbtx.Querier, date string) (*pressing.DailyZ, error)
	Monthly(ctx context.Context, q dbtx.Querier, month string) (*pressing.MonthlyReport, error)
	ListPayments(ctx context.Context, q dbtx.Querier, from, to string, limit int) ([]*pressing.PaymentRecord, error)
}

type ReportsService struct {
	store ZStore
	txm   TxRunner
}

func NewReportsService(store ZStore, txm TxRunner) *ReportsService {
	return &ReportsService{store: store, txm: txm}
}

func (s *ReportsService) DailyZ(ctx context.Context, date string) (*pressing.DailyZ, error) {
	if date == "" {
		date = time.Now().Format("2006-01-02")
	}
	if len(date) != 10 || date[4] != '-' || date[7] != '-' {
		return nil, fmt.Errorf("date invalide (YYYY-MM-DD)")
	}
	var z *pressing.DailyZ
	err := s.txm.WithTx(ctx, func(ctx context.Context, q dbtx.Querier) error {
		var err error
		z, err = s.store.DailyZ(ctx, q, date)
		return err
	})
	return z, err
}

func (s *ReportsService) Monthly(ctx context.Context, month string) (*pressing.MonthlyReport, error) {
	if month == "" {
		month = time.Now().Format("2006-01")
	}
	if len(month) != 7 || month[4] != '-' {
		return nil, fmt.Errorf("mois invalide (YYYY-MM)")
	}
	var m *pressing.MonthlyReport
	err := s.txm.WithTx(ctx, func(ctx context.Context, q dbtx.Querier) error {
		var err error
		m, err = s.store.Monthly(ctx, q, month)
		return err
	})
	return m, err
}

// PaymentsWindow : paiements sur une fenêtre (bootstrap).
func (s *ReportsService) PaymentsWindow(ctx context.Context, from, to string, limit int) ([]*pressing.PaymentRecord, error) {
	if limit <= 0 || limit > 2000 {
		limit = 500
	}
	var out []*pressing.PaymentRecord
	err := s.txm.WithTx(ctx, func(ctx context.Context, q dbtx.Querier) error {
		var err error
		out, err = s.store.ListPayments(ctx, q, from, to, limit)
		return err
	})
	return out, err
}
