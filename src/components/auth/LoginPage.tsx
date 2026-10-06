import React, { useState, useEffect } from 'react';
import { useNavigate, useLocation } from 'react-router-dom';
import { useAuth } from '../../context/AuthContext';
import { ApiError } from '../../services/api';
import { Activity, Eye, EyeOff, AlertCircle, Loader2 } from 'lucide-react';

export const LoginPage: React.FC = () => {
  const { login, isAuthenticated } = useAuth();
  const navigate = useNavigate();
  const location = useLocation();
  const from = (location.state as { from?: string })?.from ?? '/overview';

  const [email, setEmail]       = useState('');
  const [password, setPassword] = useState('');
  const [showPass, setShowPass] = useState(false);
  const [loading, setLoading]   = useState(false);
  const [error, setError]       = useState<string | null>(null);

  useEffect(() => {
    if (isAuthenticated) navigate(from, { replace: true });
  }, [isAuthenticated, navigate, from]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!email.trim() || !password.trim()) {
      setError('Email and password are required.');
      return;
    }
    setLoading(true);
    setError(null);
    try {
      await login(email.trim(), password);
      navigate(from, { replace: true });
    } catch (err) {
      if (err instanceof ApiError) {
        setError(err.message);
      } else {
        setError('Unable to connect to the server. Ensure the backend is running.');
      }
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="min-h-screen bg-[#070A10] flex items-center justify-center px-4">
      {/* Background grid */}
      <div className="absolute inset-0 opacity-[0.03]"
        style={{ backgroundImage: 'linear-gradient(#fff 1px,transparent 1px),linear-gradient(90deg,#fff 1px,transparent 1px)', backgroundSize: '40px 40px' }}
      />

      <div className="relative w-full max-w-sm">
        {/* Brand */}
        <div className="text-center mb-8">
          <div className="inline-flex items-center justify-center w-12 h-12 bg-blue-600 rounded-xl mb-4 shadow-lg shadow-blue-900/40">
            <Activity className="w-6 h-6 text-white" />
          </div>
          <h1 className="text-xl font-bold text-white font-mono tracking-tight">SCHOLARIO OPS</h1>
          <p className="text-slate-500 text-xs font-mono mt-1">IT Operations Control Center</p>
        </div>

        {/* Card */}
        <div className="bg-[#0F1520] border border-[#1E293B] rounded-xl p-6 shadow-2xl">
          <h2 className="text-sm font-semibold text-slate-200 font-mono mb-5">Sign in to your account</h2>

          {error && (
            <div className="flex items-start gap-2.5 p-3 bg-rose-950/60 border border-rose-800/60 rounded-lg mb-4 text-xs text-rose-300 font-mono">
              <AlertCircle className="w-3.5 h-3.5 shrink-0 mt-0.5 text-rose-400" />
              <span>{error}</span>
            </div>
          )}

          <form onSubmit={handleSubmit} className="space-y-4" noValidate>
            {/* Email */}
            <div>
              <label className="block text-[11px] font-mono font-medium text-slate-400 mb-1.5">
                Email address
              </label>
              <input
                type="email"
                autoComplete="email"
                autoFocus
                value={email}
                onChange={e => setEmail(e.target.value)}
                placeholder="Email address"
                disabled={loading}
                className="w-full px-3 py-2 bg-[#0A0F1A] border border-[#1E293B] rounded-lg text-sm text-slate-100 font-mono
                           placeholder-slate-600 focus:outline-none focus:border-blue-500 focus:ring-1 focus:ring-blue-500/50
                           disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
              />
            </div>

            {/* Password */}
            <div>
              <label className="block text-[11px] font-mono font-medium text-slate-400 mb-1.5">
                Password
              </label>
              <div className="relative">
                <input
                  type={showPass ? 'text' : 'password'}
                  autoComplete="current-password"
                  value={password}
                  onChange={e => setPassword(e.target.value)}
                  placeholder="••••••••"
                  disabled={loading}
                  className="w-full px-3 py-2 pr-10 bg-[#0A0F1A] border border-[#1E293B] rounded-lg text-sm text-slate-100 font-mono
                             placeholder-slate-600 focus:outline-none focus:border-blue-500 focus:ring-1 focus:ring-blue-500/50
                             disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
                />
                <button
                  type="button"
                  onClick={() => setShowPass(v => !v)}
                  className="absolute inset-y-0 right-0 px-3 flex items-center text-slate-500 hover:text-slate-300 transition-colors"
                  tabIndex={-1}
                >
                  {showPass ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                </button>
              </div>
            </div>

            {/* Submit */}
            <button
              type="submit"
              disabled={loading}
              className="w-full flex items-center justify-center gap-2 py-2.5 px-4 bg-blue-600 hover:bg-blue-700
                         disabled:opacity-60 disabled:cursor-not-allowed text-white text-sm font-mono font-semibold
                         rounded-lg transition-colors shadow-sm shadow-blue-900/30 mt-1"
            >
              {loading ? (
                <><Loader2 className="w-4 h-4 animate-spin" /> Authenticating...</>
              ) : (
                'Sign In'
              )}
            </button>
          </form>
        </div>

        {/* First-run hint */}
        <div className="mt-4 p-3 bg-[#0D1220] border border-[#1A2436] rounded-lg text-[10px] font-mono text-slate-500 space-y-1">
          <div className="text-slate-400 font-semibold">First sign-in</div>
          <div>
            The first administrator is created when the server starts, from{' '}
            <span className="text-slate-300">ADMIN_EMAIL</span> and <span className="text-slate-300">ADMIN_PASSWORD</span>{' '}
            in the server <span className="text-slate-300">.env</span> file. Further accounts are created by an administrator on the Users page.
          </div>
        </div>
      </div>
    </div>
  );
};
