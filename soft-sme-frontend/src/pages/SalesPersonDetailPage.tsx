import React, { useEffect, useMemo, useState } from 'react';
import { Box, Button, Container, Paper, Stack, Typography } from '@mui/material';
import { useNavigate, useParams } from 'react-router-dom';
import { Bar, BarChart, CartesianGrid, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';
import { getSalesPerson, getSalesPersonSalesOrderSummary } from '../services/salesPeopleService';
import { SalesPerson } from '../types/salesPerson';
import { formatCurrency } from '../utils/formatters';

const SalesPersonDetailPage: React.FC = () => {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const [salesPerson, setSalesPerson] = useState<SalesPerson | null>(null);
  const [orders, setOrders] = useState<Array<{ sales_order_id: number; sales_order_number: string; sales_date: string; estimated_cost: number }>>([]);
  const [totalEstimated, setTotalEstimated] = useState<number>(0);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!id) return;
    (async () => {
      setLoading(true);
      setError(null);
      try {
        const [person, summary] = await Promise.all([
          getSalesPerson(id),
          getSalesPersonSalesOrderSummary(id),
        ]);
        setSalesPerson(person);
        setOrders(summary.orders || []);
        setTotalEstimated(Number(summary.total_estimated_cost || 0));
      } catch (err) {
        console.error('Failed to load sales person details', err);
        setError('Failed to load sales person details.');
      } finally {
        setLoading(false);
      }
    })();
  }, [id]);

  const chartData = useMemo(() => (
    (orders || []).map((o) => ({
      name: o.sales_order_number,
      estimated_cost: Number(o.estimated_cost || 0),
    }))
  ), [orders]);

  const monthlyChartData = useMemo(() => {
    const bucket = new Map<string, number>();
    (orders || []).forEach((o) => {
      const date = o.sales_date ? new Date(o.sales_date) : null;
      if (!date || Number.isNaN(date.getTime())) return;
      const key = `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}`;
      bucket.set(key, (bucket.get(key) || 0) + Number(o.estimated_cost || 0));
    });
    return Array.from(bucket.entries())
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([key, total]) => ({ month: key, total }));
  }, [orders]);

  const chartHeight = Math.max(320, chartData.length * 48);
  const monthlyChartHeight = Math.max(260, monthlyChartData.length * 40);

  return (
    <Container maxWidth="lg" sx={{ mt: 4, mb: 4 }}>
      <Paper sx={{ p: 3 }}>
        <Stack direction={{ xs: 'column', sm: 'row' }} spacing={2} alignItems={{ xs: 'flex-start', sm: 'center' }} justifyContent="space-between">
          <Box>
            <Typography variant="h4">{salesPerson?.sales_person_name || 'Sales Person'}</Typography>
            <Typography variant="body2" color="text.secondary">
              {salesPerson?.email || 'No email'}{salesPerson?.phone_number ? ` • ${salesPerson.phone_number}` : ''}
            </Typography>
          </Box>
          <Button variant="outlined" onClick={() => navigate('/sales-people')}>Back to Sales People</Button>
        </Stack>

        {loading && <Typography sx={{ mt: 3 }}>Loading summary...</Typography>}
        {error && <Typography sx={{ mt: 3, color: 'error.main' }}>{error}</Typography>}

        {!loading && !error && (
          <Box sx={{ mt: 3 }}>
            <Stack direction={{ xs: 'column', sm: 'row' }} spacing={2} sx={{ mb: 2 }}>
              <Paper variant="outlined" sx={{ p: 2, minWidth: 200 }}>
                <Typography variant="overline" color="text.secondary">Total Quoted</Typography>
                <Typography variant="h5">{formatCurrency(totalEstimated)}</Typography>
              </Paper>
              <Paper variant="outlined" sx={{ p: 2, minWidth: 200 }}>
                <Typography variant="overline" color="text.secondary">Sales Orders</Typography>
                <Typography variant="h5">{orders.length}</Typography>
              </Paper>
            </Stack>

            {orders.length === 0 ? (
              <Typography>No sales orders assigned to this sales person yet.</Typography>
            ) : (
              <>
                <Box sx={{ width: '100%', height: monthlyChartHeight, mb: 3 }}>
                  <Typography variant="subtitle1" sx={{ mb: 1, fontWeight: 600 }}>
                    Month by Month Total Quoted
                  </Typography>
                  <ResponsiveContainer width="100%" height="100%">
                    <BarChart data={monthlyChartData} margin={{ left: 16, right: 16, top: 8, bottom: 8 }}>
                      <CartesianGrid strokeDasharray="3 3" />
                      <XAxis dataKey="month" />
                      <YAxis tickFormatter={(v) => `$${Number(v).toLocaleString()}`} />
                      <Tooltip formatter={(v: any) => formatCurrency(v)} />
                      <Bar dataKey="total" fill="#0f766e" radius={[4, 4, 0, 0]} />
                    </BarChart>
                  </ResponsiveContainer>
                </Box>
                <Box sx={{ width: '100%', height: chartHeight }}>
                  <Typography variant="subtitle1" sx={{ mb: 1, fontWeight: 600 }}>
                    Sales Orders (Quoted)
                  </Typography>
                  <ResponsiveContainer width="100%" height="100%">
                    <BarChart data={chartData} layout="vertical" margin={{ left: 16, right: 16, top: 8, bottom: 8 }}>
                      <CartesianGrid strokeDasharray="3 3" />
                      <XAxis type="number" tickFormatter={(v) => `$${Number(v).toLocaleString()}`} />
                      <YAxis type="category" dataKey="name" width={120} />
                      <Tooltip formatter={(v: any) => formatCurrency(v)} />
                      <Bar dataKey="estimated_cost" fill="#1976d2" radius={[4, 4, 4, 4]} />
                    </BarChart>
                  </ResponsiveContainer>
                </Box>
              </>
            )}
          </Box>
        )}
      </Paper>
    </Container>
  );
};

export default SalesPersonDetailPage;
