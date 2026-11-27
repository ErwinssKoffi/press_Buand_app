import React, { useMemo, useState } from 'react';
import {
  Bar,
  BarChart,
  CartesianGrid,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts';
import { Plus } from 'lucide-react';
import { PaymentMethod, PaymentRecord } from '../types/pressing';
import { formatFCFA, formatShortNumber, PAYMENT_METHOD_LABELS } from '../utils/formatters';

interface MonthlyRevenueChartProps {
  payments: PaymentRecord[];
  onCreateDeposit?: () => void;
}

type PeriodRange = 6 | 12;
type ChartMode = 'total' | 'channels';

interface MonthlyBucket {
  monthKey: string; // YYYY-MM
  shortLabel: string; // ex: "nov. 26"
  fullLabel: string; // ex: "Novembre 2026"
  totalFCFA: number;
  count: number;
  especes: number;
  wave: number;
  orange_money: number;
  mtn_momo: number;
  moov_money: number;
}

const CHANNEL_COLORS: Record<PaymentMethod, string> = {
  especes: '#0f172a', // slate-900
  wave: '#0284c7', // sky-600
  orange_money: '#ea580c', // orange-600
  mtn_momo: '#ca8a04', // yellow-600
  moov_money: '#0d9488', // teal-600
};

function getMonthKeyFromDate(d: Date): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  return `${y}-${m}`;
}

function formatAxisFCFA(value: number): string {
  if (value === 0) return '0';
  if (value >= 1_000_000) {
    return `${(value / 1_000_000).toFixed(1).replace('.', ',')}M`;
  }
  if (value >= 1_000) {
    return `${Math.round(value / 1_000)}k`;
  }
  return String(value);
}

interface CustomTooltipProps {
  active?: boolean;
  payload?: Array<{ payload: MonthlyBucket }>;
  chartMode: ChartMode;
}

const RevenueTooltip: React.FC<CustomTooltipProps> = ({ active, payload, chartMode }) => {
  if (!active || !payload || payload.length === 0) return null;
  const row = payload[0]?.payload;
  if (!row) return null;

  const activeChannels = (Object.keys(PAYMENT_METHOD_LABELS) as PaymentMethod[]).filter(
    (m) => row[m] > 0
  );

  return (
    <div className="rounded-lg border border-slate-200 bg-white px-3.5 py-2.5 shadow-sm text-xs min-w-[200px]">
      <div className="font-semibold text-slate-900 capitalize">{row.fullLabel}</div>
      <div className="mt-1 flex items-baseline justify-between gap-4 border-b border-slate-100 pb-1.5">
        <span className="text-slate-500">Total encaissé</span>
        <span className="font-mono font-bold text-teal-800 tabular-nums">
          {formatFCFA(row.totalFCFA)}
        </span>
      </div>
      <div className="mt-1.5 text-[11px] text-slate-500 font-mono tabular-nums">
        {row.count} règlement{row.count > 1 ? 's' : ''} enregistré{row.count > 1 ? 's' : ''}
      </div>

      {chartMode === 'channels' && activeChannels.length > 0 && (
        <div className="mt-2 space-y-1 border-t border-slate-100 pt-1.5">
          {activeChannels.map((m) => (
            <div key={m} className="flex items-center justify-between gap-3 text-[11px]">
              <span className="inline-flex items-center gap-1.5 text-slate-600">
                <span
                  className="inline-block h-2 w-2 rounded-xs shrink-0"
                  style={{ backgroundColor: CHANNEL_COLORS[m] }}
                />
                <span>{PAYMENT_METHOD_LABELS[m]}</span>
              </span>
              <span className="font-mono font-medium text-slate-900 tabular-nums">
                {formatShortNumber(row[m])} F
              </span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
};

export const MonthlyRevenueChart: React.FC<MonthlyRevenueChartProps> = ({
  payments,
  onCreateDeposit,
}) => {
  const [range, setRange] = useState<PeriodRange>(6);
  const [chartMode, setChartMode] = useState<ChartMode>('total');

  const { buckets, periodTotal, activeMonthsAvg, currentMonthTotal, periodCount } =
    useMemo(() => {
      const now = new Date();
      // Anchor on the latest of current month or latest payment month
      let anchorYear = now.getFullYear();
      let anchorMonth = now.getMonth();

      for (const p of payments) {
        if (!p.paidAt || p.paidAt.length < 7) continue;
        const [yStr, mStr] = p.paidAt.slice(0, 7).split('-');
        const py = Number(yStr);
        const pm = Number(mStr) - 1;
        if (!Number.isNaN(py) && !Number.isNaN(pm)) {
          if (py > anchorYear || (py === anchorYear && pm > anchorMonth)) {
            anchorYear = py;
            anchorMonth = pm;
          }
        }
      }

      const shortFmt = new Intl.DateTimeFormat('fr-FR', {
        month: 'short',
        year: '2-digit',
      });
      const fullFmt = new Intl.DateTimeFormat('fr-FR', {
        month: 'long',
        year: 'numeric',
      });

      const list: MonthlyBucket[] = [];
      const byKey = new Map<string, MonthlyBucket>();

      for (let i = range - 1; i >= 0; i--) {
        const d = new Date(anchorYear, anchorMonth - i, 1);
        const key = getMonthKeyFromDate(d);
        const bucket: MonthlyBucket = {
          monthKey: key,
          shortLabel: shortFmt.format(d),
          fullLabel: fullFmt.format(d),
          totalFCFA: 0,
          count: 0,
          especes: 0,
          wave: 0,
          orange_money: 0,
          mtn_momo: 0,
          moov_money: 0,
        };
        list.push(bucket);
        byKey.set(key, bucket);
      }

      for (const p of payments) {
        const key = p.paidAt?.slice(0, 7);
        if (!key) continue;
        const target = byKey.get(key);
        if (!target) continue;
        target.totalFCFA += p.amountFCFA;
        target.count += 1;
        if (p.method in target) {
          target[p.method] += p.amountFCFA;
        }
      }

      const total = list.reduce((s, b) => s + b.totalFCFA, 0);
      const count = list.reduce((s, b) => s + b.count, 0);
      const activeMonths = list.filter((b) => b.totalFCFA > 0);
      const avg = activeMonths.length > 0 ? Math.round(total / activeMonths.length) : 0;
      const currentKey = getMonthKeyFromDate(now);
      const currentMonth = byKey.get(currentKey)?.totalFCFA ?? list[list.length - 1]?.totalFCFA ?? 0;

      return {
        buckets: list,
        periodTotal: total,
        activeMonthsAvg: avg,
        currentMonthTotal: currentMonth,
        periodCount: count,
      };
    }, [payments, range]);

  return (
    <section
      className="rounded-xl border border-slate-200 bg-white p-5 space-y-5"
      aria-label="Évolution des revenus mensuels"
    >
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-4 border-b border-slate-100 pb-4">
        <div>
          <h2 className="text-base font-semibold text-slate-900">
            Revenus mensuels encaissés
          </h2>
          <p className="text-xs text-slate-500">
            Basé sur les règlements enregistrés (acomptes, soldes et paiements intégraux)
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <div
            className="inline-flex rounded-lg border border-slate-200 bg-slate-100 p-0.5"
            role="group"
            aria-label="Mode d'affichage du graphique"
          >
            <button
              type="button"
              onClick={() => setChartMode('total')}
              className={`rounded-md px-2.5 py-1 text-xs font-medium transition-colors whitespace-nowrap shrink-0 cursor-pointer ${
                chartMode === 'total'
                  ? 'bg-white text-slate-900 shadow-xs'
                  : 'text-slate-600 hover:text-slate-900'
              }`}
            >
              Total mensuel
            </button>
            <button
              type="button"
              onClick={() => setChartMode('channels')}
              className={`rounded-md px-2.5 py-1 text-xs font-medium transition-colors whitespace-nowrap shrink-0 cursor-pointer ${
                chartMode === 'channels'
                  ? 'bg-white text-slate-900 shadow-xs'
                  : 'text-slate-600 hover:text-slate-900'
              }`}
            >
              Par mode de paiement
            </button>
          </div>

          <div
            className="inline-flex rounded-lg border border-slate-200 bg-slate-100 p-0.5"
            role="group"
            aria-label="Période du graphique"
          >
            <button
              type="button"
              onClick={() => setRange(6)}
              className={`rounded-md px-2.5 py-1 text-xs font-medium transition-colors whitespace-nowrap shrink-0 cursor-pointer ${
                range === 6
                  ? 'bg-slate-900 text-white'
                  : 'text-slate-600 hover:text-slate-900'
              }`}
            >
              6 mois
            </button>
            <button
              type="button"
              onClick={() => setRange(12)}
              className={`rounded-md px-2.5 py-1 text-xs font-medium transition-colors whitespace-nowrap shrink-0 cursor-pointer ${
                range === 12
                  ? 'bg-slate-900 text-white'
                  : 'text-slate-600 hover:text-slate-900'
              }`}
            >
              12 mois
            </button>
          </div>
        </div>
      </div>

      {/* Period Summary Metrics Row (unboxed tabular figures) */}
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-4 text-xs">
        <div>
          <div className="text-slate-500">Cumul sur {range} mois</div>
          <div className="mt-1 font-mono text-lg font-bold text-slate-900 tabular-nums">
            {formatFCFA(periodTotal)}
          </div>
          <div className="text-[11px] text-slate-500 font-mono tabular-nums">
            {periodCount} règlement{periodCount > 1 ? 's' : ''}
          </div>
        </div>

        <div className="sm:border-l sm:border-slate-100 sm:pl-4">
          <div className="text-slate-500">Mois en cours</div>
          <div className="mt-1 font-mono text-lg font-bold text-teal-800 tabular-nums">
            {formatFCFA(currentMonthTotal)}
          </div>
          <div className="text-[11px] text-slate-500">Encaissements validés</div>
        </div>

        <div className="sm:border-l sm:border-slate-100 sm:pl-4">
          <div className="text-slate-500">Moyenne par mois actif</div>
          <div className="mt-1 font-mono text-lg font-bold text-slate-900 tabular-nums">
            {formatFCFA(activeMonthsAvg)}
          </div>
          <div className="text-[11px] text-slate-500">Sur les mois avec encaissements</div>
        </div>
      </div>

      {payments.length === 0 ? (
        <div className="rounded-lg border border-dashed border-slate-200 py-12 px-4 text-center">
          <p className="text-sm font-medium text-slate-700">
            Aucun paiement enregistré pour le moment.
          </p>
          <p className="mt-1 text-xs text-slate-500">
            Les revenus mensuels apparaîtront ici dès que vous encaisserez un acompte ou un solde.
          </p>
          {onCreateDeposit && (
            <button
              type="button"
              onClick={onCreateDeposit}
              className="mt-4 inline-flex items-center gap-1.5 rounded-lg bg-teal-700 px-4 py-2 text-xs font-medium text-white hover:bg-teal-800 cursor-pointer"
            >
              <Plus className="h-3.5 w-3.5" />
              <span>Enregistrer un premier dépôt</span>
            </button>
          )}
        </div>
      ) : (
        <div className="space-y-3">
          <div className="h-64 w-full">
            <ResponsiveContainer width="100%" height="100%">
              <BarChart
                data={buckets}
                margin={{ top: 8, right: 8, left: -8, bottom: 0 }}
                barCategoryGap="24%"
              >
                <CartesianGrid
                  strokeDasharray="3 3"
                  vertical={false}
                  stroke="#e2e8f0"
                />
                <XAxis
                  dataKey="shortLabel"
                  axisLine={false}
                  tickLine={false}
                  tick={{ fill: '#64748b', fontSize: 11 }}
                  dy={6}
                />
                <YAxis
                  axisLine={false}
                  tickLine={false}
                  tickFormatter={formatAxisFCFA}
                  tick={{
                    fill: '#64748b',
                    fontSize: 11,
                    fontFamily: 'JetBrains Mono, monospace',
                  }}
                  width={48}
                />
                <Tooltip
                  cursor={{ fill: '#f8fafc' }}
                  content={<RevenueTooltip chartMode={chartMode} />}
                />

                {chartMode === 'total' ? (
                  <Bar
                    dataKey="totalFCFA"
                    name="Revenus FCFA"
                    fill="#0f766e"
                    radius={[4, 4, 0, 0]}
                    maxBarSize={44}
                  />
                ) : (
                  (Object.keys(PAYMENT_METHOD_LABELS) as PaymentMethod[]).map((method, idx, arr) => (
                    <Bar
                      key={method}
                      dataKey={method}
                      stackId="rev"
                      name={PAYMENT_METHOD_LABELS[method]}
                      fill={CHANNEL_COLORS[method]}
                      radius={idx === arr.length - 1 ? [4, 4, 0, 0] : [0, 0, 0, 0]}
                      maxBarSize={44}
                    />
                  ))
                )}
              </BarChart>
            </ResponsiveContainer>
          </div>

          {chartMode === 'channels' && (
            <div className="flex flex-wrap items-center gap-x-5 gap-y-1.5 border-t border-slate-100 pt-3 text-[11px] text-slate-600">
              {(Object.keys(PAYMENT_METHOD_LABELS) as PaymentMethod[]).map((method) => (
                <div key={method} className="inline-flex items-center gap-1.5">
                  <span
                    className="inline-block h-2.5 w-2.5 rounded-xs shrink-0"
                    style={{ backgroundColor: CHANNEL_COLORS[method] }}
                  />
                  <span>{PAYMENT_METHOD_LABELS[method]}</span>
                </div>
              ))}
            </div>
          )}
        </div>
      )}
    </section>
  );
};
