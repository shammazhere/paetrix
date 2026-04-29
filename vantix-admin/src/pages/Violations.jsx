import React, { useState, useEffect } from 'react';
import api from '../utils/api';
import { Shield, AlertCircle, ExternalLink, Search, Filter, Calendar, ChevronLeft, ChevronRight, Eye } from 'lucide-react';

const Violations = () => {
    const [violations, setViolations] = useState([]);
    const [loading, setLoading] = useState(true);
    const [page, setPage] = useState(1);
    const [totalPages, setTotalPages] = useState(1);
    const [filterType, setFilterType] = useState('');
    const [searchTerm, setSearchTerm] = useState('');
    const [stats, setStats] = useState({});

    const fetchViolations = async () => {
        setLoading(true);
        try {
            const params = new URLSearchParams({
                page,
                limit: 15,
                type: filterType,
                search: searchTerm
            });
            const res = await api.get(`/violations?${params.toString()}`);
            if (res.data.success) {
                setViolations(res.data.violations);
                setTotalPages(res.data.pages || 1);
            }
            
            const statsRes = await api.get('/violations/stats');
            if (statsRes.data.success) {
                setStats(statsRes.data.stats);
            }
        } catch (err) {
            console.error("Error fetching violations", err);
        } finally {
            setLoading(false);
        }
    };

    useEffect(() => {
        fetchViolations();
    }, [page, filterType, searchTerm]);

    const getSeverity = (type) => {
        const critical = ['Credit Card', 'API Key', 'Aadhaar Number', 'PAN Number'];
        if (critical.includes(type)) return 'Critical';
        return 'High';
    };

    return (
        <div className="flex flex-col gap-6">
            <header className="flex justify-between items-center">
                <div>
                    <h1 className="text-2xl font-bold text-white">Violation Audit Log</h1>
                    <p className="text-slate-400">Detailed history of all blocked data leakage attempts.</p>
                </div>
                <div className="flex gap-3">
                    <button onClick={fetchViolations} className="p-2 bg-white/5 rounded-lg hover:bg-white/10 transition-colors">
                        <Shield size={20} className="text-blue-400" />
                    </button>
                </div>
            </header>

            {/* Quick Stats */}
            <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
                <div className="glass-card p-4">
                    <p className="text-xs text-slate-400 uppercase tracking-wider font-bold mb-1">Total Blocked</p>
                    <p className="text-2xl font-bold text-white">{stats.total || 0}</p>
                </div>
                <div className="glass-card p-4">
                    <p className="text-xs text-slate-400 uppercase tracking-wider font-bold mb-1">Critical Leaks</p>
                    <p className="text-2xl font-bold text-red-500">{stats['Credit Card'] || 0}</p>
                </div>
                <div className="glass-card p-4">
                    <p className="text-xs text-slate-400 uppercase tracking-wider font-bold mb-1">Unique Users</p>
                    <p className="text-2xl font-bold text-blue-400">{stats.uniqueUsers || 0}</p>
                </div>
                <div className="glass-card p-4">
                    <p className="text-xs text-slate-400 uppercase tracking-wider font-bold mb-1">Top Platform</p>
                    <p className="text-2xl font-bold text-green-400">ChatGPT</p>
                </div>
            </div>

            {/* Filters */}
            <div className="glass-card flex flex-wrap gap-4 items-center">
                <div className="relative flex-1 min-w-[200px]">
                    <Search className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-500" size={16} />
                    <input 
                        type="text" 
                        placeholder="Search by user email or URL..." 
                        className="w-full bg-white/5 border border-white/10 rounded-lg py-2 pl-10 pr-4 focus:outline-none focus:border-blue-500"
                        value={searchTerm}
                        onChange={(e) => setSearchTerm(e.target.value)}
                    />
                </div>
                <select 
                    className="bg-white/5 border border-white/10 rounded-lg py-2 px-4 focus:outline-none focus:border-blue-500"
                    value={filterType}
                    onChange={(e) => setFilterType(e.target.value)}
                >
                    <option value="">All Types</option>
                    <option value="Credit Card">Credit Card</option>
                    <option value="API Key">API Key</option>
                    <option value="Email">Email</option>
                    <option value="Phone">Phone</option>
                    <option value="Keyword">Keyword</option>
                </select>
                <button className="flex items-center gap-2 px-4 py-2 bg-white/5 border border-white/10 rounded-lg hover:bg-white/10">
                    <Calendar size={16} />
                    <span>Last 30 Days</span>
                </button>
            </div>

            {/* Table */}
            <div className="glass-card overflow-hidden !p-0">
                <div className="overflow-x-auto">
                    <table className="w-full text-left">
                        <thead className="bg-white/5 text-slate-400 text-xs uppercase tracking-wider">
                            <tr>
                                <th className="px-6 py-4">Timestamp</th>
                                <th className="px-6 py-4">Employee</th>
                                <th className="px-6 py-4">Platform / URL</th>
                                <th className="px-6 py-4">Violation Type</th>
                                <th className="px-6 py-4">Severity</th>
                                <th className="px-6 py-4">Action</th>
                            </tr>
                        </thead>
                        <tbody className="divide-y divide-white/5">
                            {violations.map((v) => (
                                <tr key={v._id} className="hover:bg-white/5 transition-colors">
                                    <td className="px-6 py-4 text-sm whitespace-nowrap">
                                        {new Date(v.timestamp).toLocaleString()}
                                    </td>
                                    <td className="px-6 py-4">
                                        <div className="flex flex-col">
                                            <span className="text-white font-medium">{v.email || 'Anonymous'}</span>
                                            <span className="text-[10px] text-slate-500">ID: {v.userId || 'N/A'}</span>
                                        </div>
                                    </td>
                                    <td className="px-6 py-4 max-w-xs">
                                        <div className="flex items-center gap-2 overflow-hidden">
                                            <ExternalLink size={14} className="text-blue-400 flex-shrink-0" />
                                            <span className="truncate text-slate-300 text-sm" title={v.url}>
                                                {v.url}
                                            </span>
                                        </div>
                                    </td>
                                    <td className="px-6 py-4">
                                        <div className="flex flex-wrap gap-1">
                                            {(v.matches || []).map((m, idx) => (
                                                <span key={idx} className="px-2 py-0.5 bg-blue-500/10 text-blue-400 text-[10px] rounded border border-blue-500/20 font-bold uppercase">
                                                    {m.type}
                                                </span>
                                            ))}
                                        </div>
                                    </td>
                                    <td className="px-6 py-4">
                                        <span className={`px-2 py-0.5 text-[10px] rounded font-bold uppercase ${
                                            getSeverity(v.matches?.[0]?.type) === 'Critical' 
                                            ? 'bg-red-500/10 text-red-500 border border-red-500/20' 
                                            : 'bg-orange-500/10 text-orange-500 border border-orange-500/20'
                                        }`}>
                                            {getSeverity(v.matches?.[0]?.type)}
                                        </span>
                                    </td>
                                    <td className="px-6 py-4">
                                        <button className="p-2 hover:bg-white/10 rounded-lg text-slate-400 hover:text-white transition-colors">
                                            <Eye size={16} />
                                        </button>
                                    </td>
                                </tr>
                            ))}
                        </tbody>
                    </table>
                </div>

                {/* Pagination */}
                <div className="px-6 py-4 bg-white/5 flex justify-between items-center border-t border-white/10">
                    <p className="text-sm text-slate-400">
                        Showing <span className="text-white">{violations.length > 0 ? (page - 1) * 15 + 1 : 0}</span> to <span className="text-white">{Math.min(page * 15, violations.length)}</span> of <span className="text-white">{stats.total || 0}</span> results
                    </p>
                    <div className="flex gap-2">
                        <button 
                            onClick={() => setPage(p => Math.max(1, p - 1))} 
                            disabled={page === 1}
                            className="p-2 bg-white/5 border border-white/10 rounded-lg disabled:opacity-30 hover:bg-white/10 transition-colors"
                        >
                            <ChevronLeft size={16} />
                        </button>
                        <button 
                            onClick={() => setPage(p => Math.min(totalPages, p + 1))} 
                            disabled={page === totalPages}
                            className="p-2 bg-white/5 border border-white/10 rounded-lg disabled:opacity-30 hover:bg-white/10 transition-colors"
                        >
                            <ChevronRight size={16} />
                        </button>
                    </div>
                </div>
            </div>
        </div>
    );
};

export default Violations;
