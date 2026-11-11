"use client";

import React, { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import {
  GitBranch,
  Folder,
  Cpu,
  DollarSign,
  Play,
  Key,
  Shield,
  AlertCircle,
  Sliders,
  CheckCircle2,
  PlusCircle,
  ExternalLink,
  Sparkles,
  Zap,
  Search,
  Filter,
  Box,
  RefreshCw,
  Info,
  Target,
  Crosshair,
  HelpCircle,
  Layers,
} from "lucide-react";
import { api } from "@/lib/api";

interface ProviderInfo {
  provider: string;
  api_key_masked?: string;
  api_base_url?: string;
  is_active: boolean;
}

interface CuratedModelDef {
  id: string;
  display_name: string;
  context_window: number;
  role: "fast" | "smart";
}

const MODEL_PRESETS = [
  { id: "gemini/gemini-3.5-flash-lite", label: "Gemini 3.5 Flash Lite (Google AI)" },
  { id: "gemini/gemini-3.8-flash", label: "Gemini 3.8 Flash (Google AI)" },
  { id: "claude-3-5-sonnet-20241022", label: "Claude 3.5 Sonnet (Anthropic)" },
  { id: "openai/gpt-4o", label: "GPT-4o (OpenAI)" },
  { id: "custom", label: "Custom (type below)" },
];

const SANDBOX_OPTIONS = [
  { id: "static-only", label: "Static Only", desc: "No code execution — fast, safe" },
  { id: "microsandbox", label: "MicroSandbox (Docker)", desc: "Isolated Docker execution for PoC" },
  { id: "gvisor", label: "gVisor", desc: "Kernel-level isolation for PoC" },
];

interface SwarmAgentDef {
  id: string;
  num: string;
  name: string;
  squadKey: string;
  squadName: string;
  desc: string;
  isDeterministic?: boolean;
}

const SWARM_15_AGENTS: SwarmAgentDef[] = [
  { id: "history", num: "01", name: "History Miner", squadKey: "recon", squadName: "Recon & Surface", desc: "Historical Learnings & Git Delta Miner" },
  { id: "structural_index", num: "02", name: "AST Indexer", squadKey: "recon", squadName: "Recon & Surface", desc: "Tree-Sitter AST & Symbol Grounding", isDeterministic: true },
  { id: "architect", num: "03", name: "System Architect", squadKey: "recon", squadName: "Recon & Surface", desc: "System Architecture & Ingress Surface Mapper" },
  { id: "threat_modeler", num: "04", name: "Threat Modeler", squadKey: "threat_model", squadName: "Threat & Strategy", desc: "STRIDE Threat Matrix & Security Sink Identification" },
  { id: "planner", num: "05", name: "Campaign Planner", squadKey: "threat_model", squadName: "Threat & Strategy", desc: "Audit Campaign Strategist & Hunting Plan" },
  { id: "researcher", num: "06", name: "Vulnerability Researcher", squadKey: "research", squadName: "Vulnerability Audit", desc: "Deep Taint Flow & Exploit Hypothesis Generator" },
  { id: "deduplicator", num: "08", name: "Deduplicator", squadKey: "critic", squadName: "Adversarial Triage", desc: "Finding Deduplication & Clustering" },
  { id: "reviewer", num: "09", name: "Mechanical Reviewer", squadKey: "critic", squadName: "Adversarial Triage", desc: "Mechanical Pre-Verification Reviewer" },
  { id: "critic", num: "11", name: "Adversarial Critic", squadKey: "critic", squadName: "Adversarial Triage", desc: "Adversarial Red-Team Falsifier & Stress-Tester" },
  { id: "reproducer", num: "13", name: "Exploit Reproducer", squadKey: "reproduce", squadName: "Exploitation & Fix", desc: "Dynamic Sandboxed PoC Exploit Reproducer" },
  { id: "chainer", num: "15", name: "Exploit Chainer", squadKey: "reproduce", squadName: "Exploitation & Fix", desc: "Multi-Step Exploit Chainer" },
  { id: "patcher", num: "16", name: "Automated Patcher", squadKey: "reproduce", squadName: "Exploitation & Fix", desc: "Autonomous Zero-Regression Patch Synthesizer" },
  { id: "calibrator", num: "17", name: "Risk Calibrator", squadKey: "reproduce", squadName: "Exploitation & Fix", desc: "CVSS 4.0 Risk & Blast-Radius Scorer" },
  { id: "reflector", num: "18", name: "Meta-Learner", squadKey: "reproduce", squadName: "Exploitation & Fix", desc: "Meta-Learner & Knowledge Distillation" },
  { id: "reporter", num: "19", name: "Advisory Reporter", squadKey: "reproduce", squadName: "Exploitation & Fix", desc: "Pentest Advisory & SARIF 2.1.0 Reporter" },
];

interface SwarmSquadDef {
  key: string;
  num: string;
  name: string;
  nodes: string;
  desc: string;
  agentIds: string[];
  gates?: string;
}

const SWARM_SQUADS: SwarmSquadDef[] = [
  {
    key: "recon",
    num: "SQUAD 01",
    name: "Recon & Surface Mapping",
    nodes: "history, structural_index, architect",
    desc: "AST structural indexing & historical delta tracking",
    agentIds: ["history", "structural_index", "architect"],
  },
  {
    key: "threat_model",
    num: "SQUAD 02",
    name: "Threat Modeling & Strategy",
    nodes: "threat_modeler, planner",
    desc: "STRIDE matrix, trust boundary mapping & hunting plans",
    agentIds: ["threat_modeler", "planner"],
  },
  {
    key: "research",
    num: "SQUAD 03",
    name: "Deep Vulnerability Audit",
    nodes: "researcher",
    desc: "Taint flow tracing, SMT constraint solving & exploit hypothesis",
    agentIds: ["researcher"],
    gates: "07 findings_gate",
  },
  {
    key: "critic",
    num: "SQUAD 04",
    name: "Adversarial Triage & Falsification",
    nodes: "deduplicator, reviewer, critic",
    desc: "Adversarial stress testing, deduplication & FP elimination",
    agentIds: ["deduplicator", "reviewer", "critic"],
    gates: "10 reviewer_classifier, 12 critic_classifier",
  },
  {
    key: "reproduce",
    num: "SQUAD 05",
    name: "Exploitation & Remediation",
    nodes: "reproducer, chainer, patcher, calibrator, reflector, reporter",
    desc: "Dynamic PoC execution, patch synthesis & CVSS scoring",
    agentIds: ["reproducer", "chainer", "patcher", "calibrator", "reflector", "reporter"],
    gates: "14 repro_classifier",
  },
];

interface SwarmStageDef {
  key: string;
  num: string;
  name: string;
  nodes: string;
  desc: string;
}

const SWARM_STAGES: SwarmStageDef[] = [
  {
    key: "recon",
    num: "02",
    name: "Recon & Indexing",
    nodes: "history, structural_index",
    desc: "AST structural indexing & delta tracking (Deterministic Tree-Sitter + Fast LLM)",
  },
  {
    key: "threat_model",
    num: "03",
    name: "Threat Modeling",
    nodes: "architect, threat_modeler",
    desc: "STRIDE matrix, trust boundary mapping & security sink identification",
  },
  {
    key: "research",
    num: "04",
    name: "Deep Vulnerability Audit",
    nodes: "planner, researcher",
    desc: "Taint flow tracing, SMT constraint solving & vulnerability hypothesis generation",
  },
  {
    key: "critic",
    num: "05",
    name: "Adversarial Critic & Triage",
    nodes: "deduplicator, reviewer, critic",
    desc: "Adversarial hypothesis stress testing, FP pruning & exploitability review",
  },
  {
    key: "reproduce",
    num: "06",
    name: "Dynamic Exploit Reproducer",
    nodes: "reproducer, chainer",
    desc: "Dynamic PoC harness synthesis, Docker/MicroSandbox verification & exploit chains",
  },
  {
    key: "patch",
    num: "07",
    name: "Patch & Risk Calibration",
    nodes: "patcher, calibrator, reporter",
    desc: "Zero-regression patch generation, CVSS risk scoring & pentest reporting",
  },
];

export default function NewScanPage() {
  const router = useRouter();

  // Source configuration
  const [scanName, setScanName] = useState("");
  const [sourceType, setSourceType] = useState<"git" | "local">("git");
  const [sourceTarget, setSourceTarget] = useState("");
  const [branch, setBranch] = useState("");
  const [gitToken, setGitToken] = useState("");

  // Native engine execution flags
  const [routingMode, setRoutingMode] = useState<"single" | "swarm">("single");
  const [swarmPreset, setSwarmPreset] = useState<string>("balanced");
  const [modelPreset, setModelPreset] = useState("gemini/gemini-3.5-flash-lite");
  const [customModel, setCustomModel] = useState("");
  const [reasoningEffort, setReasoningEffort] = useState<"low" | "medium" | "high">("medium");
  const [focus, setFocus] = useState("");
  const [excludePatterns, setExcludePatterns] = useState("");
  const [sandbox, setSandbox] = useState("static-only");
  const [maxTokens, setMaxTokens] = useState<number | "">("");
  const [resumeScan, setResumeScan] = useState(false);
  const [scanMode, setScanMode] = useState<"auto" | "whole" | "file-by-file" | "cross-functional">("auto");
  const [objective, setObjective] = useState("");
  const [seedReport, setSeedReport] = useState("");
  const [deterministicOnly, setDeterministicOnly] = useState(false);
  const [noReplan, setNoReplan] = useState(false);
  const [parallel, setParallel] = useState(1);
  const [maxLlmCalls, setMaxLlmCalls] = useState<number | "">("");
  const [showAdvancedEngine, setShowAdvancedEngine] = useState(false);

  // Budget
  const [budgetLimit, setBudgetLimit] = useState(5.0);

  // Audit Mode
  const [freshScan, setFreshScan] = useState(false);

  // Providers & Whitelisted Models
  const [providers, setProviders] = useState<ProviderInfo[]>([]);
  const [availableModels, setAvailableModels] = useState<any[]>([]);
  const [preset, setPreset] = useState<string>("ollama");
  const [showCustomPhases, setShowCustomPhases] = useState(false);
  const [swarmConfigMode, setSwarmConfigMode] = useState<"squads" | "agents">("squads");

  // Per-phase / Per-agent model assignments
  const [phaseModels, setPhaseModels] = useState<Record<string, string>>({
    // Squads
    recon: "gemini/gemini-3.5-flash-lite",
    threat_model: "gemini/gemini-3.8-flash",
    research: "claude-3-5-sonnet-20241022",
    reproduce: "claude-3-5-sonnet-20241022",
    patch: "gemini/gemini-3.8-flash",
    // 15 Individual Agents
    history: "gemini/gemini-3.5-flash-lite",
    structural_index: "gemini/gemini-3.5-flash-lite",
    architect: "gemini/gemini-3.8-flash",
    threat_modeler: "gemini/gemini-3.8-flash",
    planner: "gemini/gemini-3.8-flash",
    researcher: "claude-3-5-sonnet-20241022",
    deduplicator: "gemini/gemini-3.5-flash-lite",
    reviewer: "gemini/gemini-3.8-flash",
    critic: "openai/gpt-4o",
    reproducer: "claude-3-5-sonnet-20241022",
    chainer: "openai/gpt-4o",
    patcher: "claude-3-5-sonnet-20241022",
    calibrator: "gemini/gemini-3.8-flash",
    reflector: "gemini/gemini-3.5-flash-lite",
    reporter: "gemini/gemini-3.8-flash",
  });

  const [customStageModels, setCustomStageModels] = useState<Record<string, string>>({
    recon: "",
    threat_model: "",
    research: "",
    critic: "",
    reproduce: "",
    patch: "",
  });

  // Per-phase / Per-agent reasoning efforts
  const [phaseEfforts, setPhaseEfforts] = useState<Record<string, "low" | "medium" | "high">>({
    recon: "low",
    threat_model: "medium",
    research: "high",
    reproduce: "high",
    patch: "high",
    history: "low",
    structural_index: "low",
    architect: "medium",
    threat_modeler: "medium",
    planner: "medium",
    researcher: "high",
    deduplicator: "low",
    reviewer: "medium",
    critic: "high",
    reproducer: "high",
    chainer: "high",
    patcher: "high",
    calibrator: "medium",
    reflector: "medium",
    reporter: "medium",
  });

  const [loading, setLoading] = useState(false);
  const [actionLoading, setActionLoading] = useState(false);
  const [whitelistSuccessMsg, setWhitelistSuccessMsg] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  // Refresh data from backend
  const loadData = async () => {
    try {
      const [provList, modelList] = await Promise.all([
        api.getProviders().catch(() => []),
        api.getModels().catch(() => []),
      ]);
      setProviders(provList);
      const enabled = modelList.filter((m) => m.is_enabled);
      setAvailableModels(enabled);

      return { provList, enabled };
    } catch {
      return { provList: [], enabled: [] };
    }
  };

  useEffect(() => {
    if (typeof window !== "undefined") {
      const sp = new URLSearchParams(window.location.search);
      const st = sp.get("source_type");
      const target = sp.get("source_target");
      const name = sp.get("name");
      if (st === "local" || st === "git") setSourceType(st);
      if (target) setSourceTarget(target);
      if (name) setScanName(name);
    }

    loadData().then(({ provList, enabled }) => {
      // Auto-select first configured provider with models
      const hasOllama = isProviderConfigured("ollama", provList);
      const hasOpenAI = isProviderConfigured("openai", provList);
      const hasAnthropic = isProviderConfigured("anthropic", provList);
      const hasGoogle = isProviderConfigured("google", provList);

      let initialPreset = "custom";
      if (hasOllama && enabled.some((m) => m.provider === "ollama")) {
        initialPreset = "ollama";
      } else if (hasOpenAI && enabled.some((m) => m.provider === "openai")) {
        initialPreset = "openai";
      } else if (hasAnthropic && enabled.some((m) => m.provider === "anthropic")) {
        initialPreset = "anthropic";
      } else if (hasGoogle && enabled.some((m) => m.provider === "google")) {
        initialPreset = "gemini";
      } else if (enabled.length > 0) {
        initialPreset = "frontier";
      }

      applyPreset(initialPreset, enabled);
    });
  }, []);

  const isProviderConfigured = (pName: string, provList: ProviderInfo[] = providers): boolean => {
    const p = provList.find((item) => item.provider === pName);
    if (!p) return false;
    if (pName === "ollama") {
      return Boolean((p.api_key_masked && p.api_key_masked.trim()) || (p.api_base_url && p.api_base_url.trim()));
    }
    return Boolean(p.api_key_masked && p.api_key_masked.trim());
  };

  const getProviderModels = (pName: string, models: any[] = availableModels): any[] => {
    return models.filter((m) => m.provider === pName);
  };

  // Curated recommended models per provider
  const curatedRecommendations: Record<string, CuratedModelDef[]> = {
    ollama: [
      {
        id: "ollama/deepseek-v4.1-flash",
        display_name: "DeepSeek V4.1 Flash (Ollama Cloud)",
        context_window: 128000,
        role: "fast",
      },
      {
        id: "ollama/deepseek-v4-pro:0813",
        display_name: "DeepSeek V4 Pro (Ollama Cloud)",
        context_window: 128000,
        role: "smart",
      },
    ],
    openai: [
      {
        id: "openai/gpt-4o-mini",
        display_name: "GPT-4o Mini",
        context_window: 128000,
        role: "fast",
      },
      {
        id: "openai/gpt-4o",
        display_name: "GPT-4o",
        context_window: 128000,
        role: "smart",
      },
    ],
    anthropic: [
      {
        id: "anthropic/claude-3-5-haiku",
        display_name: "Claude 3.5 Haiku",
        context_window: 200000,
        role: "fast",
      },
      {
        id: "anthropic/claude-3-5-sonnet",
        display_name: "Claude 3.5 Sonnet",
        context_window: 200000,
        role: "smart",
      },
    ],
    gemini: [
      {
        id: "gemini/gemini-1.5-flash",
        display_name: "Gemini 1.5 Flash (1M Ctx)",
        context_window: 1048576,
        role: "fast",
      },
      {
        id: "gemini/gemini-1.5-pro",
        display_name: "Gemini 1.5 Pro",
        context_window: 1048576,
        role: "smart",
      },
    ],
  };

  const applySwarmPreset = (presetKey: string) => {
    setSwarmPreset(presetKey);
    let sFast = "gemini/gemini-3.5-flash-lite";
    let sSmart = "gemini/gemini-3.8-flash";
    let sReasoning = "claude-3-5-sonnet-20241022";
    let sCritic = "openai/gpt-4o";
    let sRepro = "claude-3-5-sonnet-20241022";
    let sPatch = "gemini/gemini-3.8-flash";

    let eFast: "low" | "medium" | "high" = "low";
    let eSmart: "low" | "medium" | "high" = "medium";
    let eStrong: "low" | "medium" | "high" = "high";

    if (presetKey === "balanced") {
      sFast = "gemini/gemini-3.5-flash-lite";
      sSmart = "gemini/gemini-3.8-flash";
      sReasoning = "claude-3-5-sonnet-20241022";
      sCritic = "openai/gpt-4o";
      sRepro = "claude-3-5-sonnet-20241022";
      sPatch = "gemini/gemini-3.8-flash";
    } else if (presetKey === "adversarial") {
      sFast = "gemini/gemini-3.5-flash-lite";
      sSmart = "openai/gpt-4o";
      sReasoning = "claude-3-5-sonnet-20241022";
      sCritic = "openai/gpt-4o";
      sRepro = "claude-3-5-sonnet-20241022";
      sPatch = "openai/gpt-4o";
    } else if (presetKey === "budget") {
      sFast = "gemini/gemini-3.5-flash-lite";
      sSmart = "gemini/gemini-3.5-flash-lite";
      sReasoning = "gemini/gemini-3.8-flash";
      sCritic = "gemini/gemini-3.8-flash";
      sRepro = "gemini/gemini-3.8-flash";
      sPatch = "gemini/gemini-3.5-flash-lite";
      eFast = "low";
      eSmart = "low";
      eStrong = "medium";
    } else if (presetKey === "frontier") {
      sFast = "claude-3-5-sonnet-20241022";
      sSmart = "claude-3-5-sonnet-20241022";
      sReasoning = "claude-3-5-sonnet-20241022";
      sCritic = "openai/gpt-4o";
      sRepro = "claude-3-5-sonnet-20241022";
      sPatch = "claude-3-5-sonnet-20241022";
      eFast = "medium";
      eSmart = "medium";
      eStrong = "high";
    }

    setPhaseModels({
      // 5 Squads
      recon: sFast,
      threat_model: sSmart,
      research: sReasoning,
      reproduce: sRepro,
      patch: sPatch,
      // 15 Agents
      history: sFast,
      structural_index: sFast,
      architect: sSmart,
      threat_modeler: sSmart,
      planner: sSmart,
      researcher: sReasoning,
      deduplicator: sFast,
      reviewer: sSmart,
      critic: sCritic,
      reproducer: sRepro,
      chainer: sCritic,
      patcher: sRepro,
      calibrator: sSmart,
      reflector: sFast,
      reporter: sPatch,
    });

    setPhaseEfforts({
      recon: eFast,
      threat_model: eSmart,
      research: eStrong,
      reproduce: eStrong,
      patch: eStrong,
      history: eFast,
      structural_index: "low",
      architect: eSmart,
      threat_modeler: eSmart,
      planner: eSmart,
      researcher: eStrong,
      deduplicator: eFast,
      reviewer: eSmart,
      critic: eStrong,
      reproducer: eStrong,
      chainer: eStrong,
      patcher: eStrong,
      calibrator: eSmart,
      reflector: eFast,
      reporter: eSmart,
    });
  };

  const handleSquadModelChange = (squadKey: string, modelVal: string, agentIds: string[]) => {
    setPhaseModels((prev) => {
      const next = { ...prev, [squadKey]: modelVal };
      agentIds.forEach((aid) => {
        next[aid] = modelVal;
      });
      return next;
    });
  };

  const handleSquadEffortChange = (
    squadKey: string,
    effortVal: "low" | "medium" | "high",
    agentIds: string[]
  ) => {
    setPhaseEfforts((prev) => {
      const next = { ...prev, [squadKey]: effortVal };
      agentIds.forEach((aid) => {
        next[aid] = effortVal;
      });
      return next;
    });
  };

  const applyPreset = (selectedPreset: string, models: any[] = availableModels) => {
    setPreset(selectedPreset);
    if (models.length === 0) return;

    const findModel = (predicate: (m: any) => boolean, fallback: string) => {
      const found = models.find(predicate);
      return found ? found.id : (models[0]?.id || fallback);
    };

    const assignSwarm = (fastM: string, smartM: string, reasoningM?: string) => {
      const strong = reasoningM || smartM;
      setPhaseModels({
        // 5 Squads
        recon: fastM,
        threat_model: smartM,
        research: strong,
        reproduce: strong,
        patch: smartM,
        // 15 Individual Agents
        history: fastM,
        structural_index: fastM,
        architect: smartM,
        threat_modeler: smartM,
        planner: smartM,
        researcher: strong,
        deduplicator: fastM,
        reviewer: fastM,
        critic: strong,
        reproducer: strong,
        chainer: smartM,
        patcher: smartM,
        calibrator: fastM,
        reflector: fastM,
        reporter: smartM,
      });
      setPhaseEfforts({
        recon: "low",
        threat_model: "medium",
        research: "high",
        reproduce: "high",
        patch: "high",
        history: "low",
        structural_index: "low",
        architect: "medium",
        threat_modeler: "medium",
        planner: "medium",
        researcher: "high",
        deduplicator: "low",
        reviewer: "medium",
        critic: "high",
        reproducer: "high",
        chainer: "high",
        patcher: "high",
        calibrator: "medium",
        reflector: "medium",
        reporter: "medium",
      });
    };

    if (selectedPreset === "ollama") {
      const ollamaModels = models.filter((m) => m.provider === "ollama");
      const fast = findModel(
        (m) => m.provider === "ollama" && (m.id.includes("flash") || m.id.includes("nano") || m.id.includes("mini")),
        ollamaModels[0]?.id || models[0]?.id
      );
      const smart = findModel(
        (m) => m.provider === "ollama" && (m.id.includes("pro") || m.id.includes("code") || m.id.includes("large") || m.id.includes("120b")),
        ollamaModels[ollamaModels.length - 1]?.id || fast
      );
      const deep = findModel(
        (m) => m.provider === "ollama" && (m.id.includes("r1") || m.id.includes("deepseek")),
        smart
      );
      assignSwarm(fast, smart, deep);
    } else if (selectedPreset === "openai") {
      const fast = findModel((m) => m.provider === "openai" && m.id.includes("mini"), models[0]?.id);
      const smart = findModel((m) => m.provider === "openai" && (m.id.includes("gpt-4o") || m.id.includes("o1")), fast);
      assignSwarm(fast, smart);
    } else if (selectedPreset === "anthropic") {
      const fast = findModel((m) => m.provider === "anthropic" && m.id.includes("haiku"), models[0]?.id);
      const smart = findModel((m) => m.provider === "anthropic" && m.id.includes("sonnet"), fast);
      assignSwarm(fast, smart);
    } else if (selectedPreset === "gemini") {
      const fast = findModel((m) => m.provider === "google" && m.id.includes("flash"), models[0]?.id);
      const smart = findModel((m) => m.provider === "google" && m.id.includes("pro"), fast);
      assignSwarm(fast, smart);
    } else if (selectedPreset === "frontier") {
      const fast = findModel((m) => m.id.includes("flash") || m.id.includes("mini") || m.id.includes("haiku"), models[0]?.id);
      const smart = findModel((m) => m.id.includes("sonnet") || m.id.includes("gpt-4o") || m.id.includes("pro"), fast);
      const deep = findModel((m) => m.id.includes("r1") || m.id.includes("o1") || m.id.includes("o3"), smart);
      assignSwarm(fast, smart, deep);
    }
  };

  // Add missing curated model to whitelist directly
  const handleWhitelistCuratedModel = async (modelDef: CuratedModelDef, targetProvider: string) => {
    setActionLoading(true);
    setWhitelistSuccessMsg(null);
    setError(null);

    try {
      const prov = targetProvider === "gemini" ? "google" : targetProvider;
      await api.addModel({
        id: modelDef.id,
        provider: prov,
        display_name: modelDef.display_name,
        context_window: modelDef.context_window,
        is_enabled: true,
      });

      const { enabled } = await loadData();
      applyPreset(preset, enabled);
      setWhitelistSuccessMsg(`Model "${modelDef.display_name}" added to whitelist and assigned to stages!`);
      setTimeout(() => setWhitelistSuccessMsg(null), 5000);
    } catch (err: any) {
      setError(`Failed to add model to whitelist: ${err.message || err}`);
    } finally {
      setActionLoading(false);
    }
  };

  const handleLaunch = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!sourceTarget.trim()) {
      setError("Please provide a repository URL or local server directory.");
      return;
    }

    setError(null);
    setLoading(true);

    // Resolve effective model and per-phase swarm mappings
    const isSwarm = routingMode === "swarm";
    const effectivePhaseModels = isSwarm ? phaseModels : undefined;
    const effectivePhaseEfforts = isSwarm ? phaseEfforts : undefined;
    const effectiveModel = isSwarm
      ? "Swarm (Multi-Model)"
      : modelPreset === "custom"
      ? customModel.trim() || undefined
      : modelPreset || undefined;

    // Parse exclude patterns
    const excludeList = excludePatterns
      .split(",")
      .map((s) => s.trim())
      .filter(Boolean);

    try {
      const res = await api.createScan({
        name: scanName.trim() || undefined,
        source_type: sourceType,
        source_target: sourceTarget.trim(),
        branch: sourceType === "git" ? branch.trim() : undefined,
        git_token: gitToken.trim() ? gitToken.trim() : undefined,
        budget_limit_usd: budgetLimit,
        fresh: freshScan,
        // Native engine execution flags & Swarm routing
        model: effectiveModel,
        phase_models: effectivePhaseModels,
        phase_efforts: effectivePhaseEfforts,
        reasoning_effort: reasoningEffort,
        focus: focus.trim() || undefined,
        exclude: excludeList.length > 0 ? excludeList : undefined,
        sandbox: sandbox,
        max_tokens: maxTokens !== "" ? maxTokens : undefined,
        resume: resumeScan,
        scan_mode: scanMode,
        objective: objective.trim() || undefined,
        seed_report: seedReport.trim() || undefined,
        deterministic_only: deterministicOnly,
        no_replan: noReplan,
        parallel: parallel > 1 ? parallel : undefined,
        max_llm_calls: maxLlmCalls !== "" ? Number(maxLlmCalls) : undefined,
      });

      router.push(`/scans/${res.id}`);
    } catch (err: any) {
      setError(err.message || "Failed to initialize scan.");
      setLoading(false);
    }
  };

  const ollamaConfig = providers.find((p) => p.provider === "ollama");
  const isOllamaCloud = Boolean(ollamaConfig?.api_base_url?.includes("ollama.com") || ollamaConfig?.api_key_masked);

  // Missing recommended models for current active preset
  const currentRecommendations = curatedRecommendations[preset] || [];
  const missingCuratedModels = currentRecommendations.filter(
    (rec) => !availableModels.some((m) => m.id === rec.id)
  );

  return (
    <div className="max-w-4xl mx-auto space-y-6">
      <div className="border-b border-slate-800 pb-3">
        <div className="flex items-center space-x-2">
          <span className="w-2 h-2 rounded-full bg-amber-400"></span>
          <span className="w-2 h-2 rounded-full bg-emerald-400"></span>
          <span className="text-xs font-mono font-bold uppercase tracking-wider text-slate-400">
            Pipeline Configuration &bull; Obsidian Amber Aurora
          </span>
        </div>
        <h1 className="text-2xl font-extrabold tracking-tight text-white mt-1 flex items-center space-x-2">
          <span>Launch Security Audit</span>
        </h1>
        <p className="text-xs text-slate-400 mt-1 font-mono">
          Configure repository source ingestion, Autonomous Swarm engine flags, and hard financial guardrails.
        </p>
      </div>

      {error && (
        <div className="p-4 bg-rose-950/60 border border-rose-800/80 rounded-xl flex items-start space-x-2.5 text-xs text-rose-200 shadow-xl">
          <AlertCircle className="w-4 h-4 text-rose-400 shrink-0 mt-0.5" />
          <span>{error}</span>
        </div>
      )}

      {whitelistSuccessMsg && (
        <div className="p-3.5 bg-emerald-950/60 border border-emerald-800/80 rounded-xl flex items-center space-x-2 text-xs text-emerald-200 shadow-xl">
          <CheckCircle2 className="w-4 h-4 text-emerald-400 shrink-0" />
          <span>{whitelistSuccessMsg}</span>
        </div>
      )}

      <form onSubmit={handleLaunch} className="space-y-6" autoComplete="off">
        {/* Section 0: Audit Identification */}
        <div className="glass-card rounded-2xl p-6 space-y-4 shadow-xl">
          <div className="flex items-center justify-between border-b border-slate-800 pb-3">
            <h2 className="text-sm font-bold text-white flex items-center space-x-2">
              <Shield className="w-4 h-4 text-amber-400" />
              <span>Audit Identification</span>
            </h2>
            <span className="text-[11px] text-slate-400 font-mono">Custom label for tracking &amp; model benchmark comparison</span>
          </div>

          <div>
            <label className="block text-xs font-semibold text-slate-300 mb-1.5 flex items-center justify-between">
              <span>Scan Name</span>
              <span className="text-[11px] text-slate-400 font-normal">Optional (defaults to repository name)</span>
            </label>
            <input
              type="text"
              value={scanName}
              onChange={(e) => setScanName(e.target.value)}
              placeholder="e.g. Enterprise Security Review, Core API Audit"
              className="w-full px-3.5 py-2.5 bg-slate-900/90 border border-slate-700 rounded-xl text-sm text-slate-100 placeholder-slate-500 focus:outline-none focus:border-amber-500 focus:bg-slate-900 focus:ring-2 focus:ring-amber-500/20 transition-all font-mono"
            />
          </div>
        </div>

        {/* Section 1: Ingestion Target */}
        <div className="glass-card rounded-2xl p-6 space-y-5 shadow-xl">
          <div className="flex items-center justify-between border-b border-slate-800 pb-3">
            <h2 className="text-sm font-bold text-white flex items-center space-x-2">
              <GitBranch className="w-4 h-4 text-amber-400" />
              <span>Target Source Code</span>
            </h2>
            <div className="flex rounded-xl bg-slate-900 p-1 border border-slate-800 text-xs">
              <button
                type="button"
                onClick={() => setSourceType("git")}
                className={`flex items-center space-x-1.5 px-3 py-1 rounded-lg font-bold transition-all ${
                  sourceType === "git" ? "bg-gradient-to-r from-amber-500 to-amber-600 text-slate-950 font-bold shadow-xs" : "text-slate-400 hover:text-slate-200"
                }`}
              >
                <GitBranch className="w-3.5 h-3.5" />
                <span>Git Remote</span>
              </button>
              <button
                type="button"
                onClick={() => setSourceType("local")}
                className={`flex items-center space-x-1.5 px-3 py-1 rounded-lg font-bold transition-all ${
                  sourceType === "local" ? "bg-gradient-to-r from-amber-500 to-amber-600 text-slate-950 font-bold shadow-xs" : "text-slate-400 hover:text-slate-200"
                }`}
              >
                <Folder className="w-3.5 h-3.5" />
                <span>Local Workspace</span>
              </button>
            </div>
          </div>

          {sourceType === "git" ? (
            <div className="space-y-4">
              {/* Dummy hidden inputs to soak up browser password manager autofill heuristics */}
              <input type="text" name="fake_username_remember" style={{ display: "none" }} tabIndex={-1} aria-hidden="true" autoComplete="off" />
              <input type="password" name="fake_password_remember" style={{ display: "none" }} tabIndex={-1} aria-hidden="true" autoComplete="new-password" />

              <div>
                <label className="block text-xs font-semibold text-slate-300 mb-1.5">
                  Git Repository URL
                </label>
                <input
                  type="text"
                  required
                  name="git_repository_url"
                  id="git_repository_url"
                  autoComplete="off"
                  data-lpignore="true"
                  data-1p-ignore="true"
                  value={sourceTarget}
                  onChange={(e) => setSourceTarget(e.target.value)}
                  placeholder="https://github.com/organization/repository.git"
                  className="w-full px-3.5 py-2.5 bg-slate-900/90 border border-slate-700 rounded-xl text-sm text-slate-100 placeholder-slate-500 focus:outline-none focus:border-amber-500 focus:bg-slate-900 focus:ring-2 focus:ring-amber-500/20 font-mono transition-all"
                />
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <div>
                  <label className="block text-xs font-semibold text-slate-300 mb-1.5">
                    Branch / Tag / Commit
                  </label>
                  <input
                    type="text"
                    id="git_branch_tag"
                    name="git_branch_tag"
                    autoComplete="off"
                    autoCorrect="off"
                    autoCapitalize="off"
                    spellCheck={false}
                    data-lpignore="true"
                    data-1p-ignore="true"
                    data-form-type="other"
                    value={branch}
                    onChange={(e) => setBranch(e.target.value)}
                    placeholder="e.g. main, master (optional)"
                    className="w-full px-3.5 py-2.5 bg-slate-900/90 border border-slate-700 rounded-xl text-sm text-slate-100 placeholder-slate-500 focus:outline-none focus:border-amber-500 focus:bg-slate-900 focus:ring-2 focus:ring-amber-500/20 font-mono transition-all"
                  />
                </div>

                <div>
                  <label className="block text-xs font-semibold text-slate-300 mb-1.5 flex items-center justify-between">
                    <span>Personal Access Token</span>
                    <span className="text-[11px] text-slate-500 font-normal">Optional</span>
                  </label>
                  <div className="relative">
                    <Key className="w-4 h-4 text-slate-500 absolute left-3 top-3" />
                    <input
                      type="password"
                      id="git_personal_access_token"
                      name="git_personal_access_token"
                      autoComplete="new-password"
                      autoCorrect="off"
                      autoCapitalize="off"
                      spellCheck={false}
                      data-lpignore="true"
                      data-1p-ignore="true"
                      data-form-type="other"
                      value={gitToken}
                      onChange={(e) => setGitToken(e.target.value)}
                      placeholder="ghp_••••••••••••••••••••"
                      className="w-full pl-9 pr-3.5 py-2.5 bg-slate-900/90 border border-slate-700 rounded-xl text-sm text-slate-100 placeholder-slate-500 focus:outline-none focus:border-amber-500 focus:bg-slate-900 focus:ring-2 focus:ring-amber-500/20 font-mono transition-all"
                    />
                  </div>
                </div>
              </div>
            </div>
          ) : (
            <div>
              <label className="block text-xs font-semibold text-slate-300 mb-1.5">
                Mounted Server Directory Path
              </label>
              <input
                type="text"
                required
                value={sourceTarget}
                onChange={(e) => setSourceTarget(e.target.value)}
                placeholder="/Users/username/project or /data/repos/my-repo"
                className="w-full px-3.5 py-2.5 bg-slate-900/90 border border-slate-700 rounded-xl text-sm text-slate-100 placeholder-slate-500 focus:outline-none focus:border-amber-500 focus:bg-slate-900 focus:ring-2 focus:ring-amber-500/20 font-mono transition-all"
              />
            </div>
          )}
        </div>

        {/* Section 2: Autonomous Engine Flags */}
        <div className="glass-card rounded-2xl p-6 space-y-5 shadow-xl">
          <div className="flex items-center justify-between border-b border-slate-800 pb-3">
            <h2 className="text-sm font-bold text-white flex items-center space-x-2">
              <Cpu className="w-4 h-4 text-amber-400" />
              <span>Autonomous Engine Execution Flags</span>
            </h2>
            <span className="text-[11px] text-amber-300 font-mono bg-amber-950/80 border border-amber-800/80 px-2 py-0.5 rounded-md">
              Native Engine
            </span>
          </div>

          {/* Strategy Selector: Single vs Swarm */}
          <div className="p-4 rounded-xl bg-slate-900/90 border border-slate-800 space-y-3">
            <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
              <div>
                <div className="flex items-center space-x-2">
                  <Sparkles className="w-4 h-4 text-amber-400" />
                  <span className="text-xs font-bold text-white font-mono uppercase tracking-wider">
                    Model Architecture Strategy
                  </span>
                  <span className="px-1.5 py-0.5 rounded text-[9px] font-black bg-amber-950/80 text-amber-300 border border-amber-500/40">
                    ADK 2.0 Native
                  </span>
                </div>
                <p className="text-[11px] text-slate-400 mt-0.5">
                  Execute using a uniform single model or distribute phases across a specialized multi-model agent swarm.
                </p>
              </div>
              <div className="inline-flex rounded-xl bg-slate-950 p-1 border border-slate-800 text-xs shrink-0">
                <button
                  type="button"
                  onClick={() => setRoutingMode("single")}
                  className={`px-3.5 py-1.5 rounded-lg font-bold transition-all cursor-pointer flex items-center space-x-1.5 ${
                    routingMode === "single"
                      ? "bg-gradient-to-r from-amber-500 to-amber-600 text-slate-950 shadow-xs glow-amber-btn"
                      : "text-slate-400 hover:text-white"
                  }`}
                >
                  <Cpu className="w-3.5 h-3.5" />
                  <span>Single Model</span>
                </button>
                <button
                  type="button"
                  onClick={() => {
                    setRoutingMode("swarm");
                    if (!phaseModels.recon) applySwarmPreset("balanced");
                  }}
                  className={`px-3.5 py-1.5 rounded-lg font-bold transition-all cursor-pointer flex items-center space-x-1.5 ${
                    routingMode === "swarm"
                      ? "bg-gradient-to-r from-amber-500 to-amber-600 text-slate-950 shadow-xs glow-amber-btn"
                      : "text-slate-400 hover:text-white"
                  }`}
                >
                  <Layers className="w-3.5 h-3.5" />
                  <span>Multi-Model Swarm</span>
                  <span className="text-[9px] px-1 py-0.2 rounded font-black bg-amber-950 text-amber-300 border border-amber-500/40 ml-1">
                    NEW
                  </span>
                </button>
              </div>
            </div>
          </div>

          {/* MODE 1: SINGLE MODEL SELECTION */}
          {routingMode === "single" && (
            <div className="space-y-4">
              <div className="space-y-3">
                <div className="flex items-center justify-between">
                  <label className="block text-xs font-semibold text-slate-300">
                    Model Architecture
                  </label>
                  {providers.find((p) => p.provider === "ollama")?.is_active && (
                    <span className="flex items-center space-x-1.5 text-[11px] font-mono text-amber-300 bg-amber-950/60 px-2.5 py-0.5 rounded-full border border-amber-800/60">
                      <span className="w-1.5 h-1.5 rounded-full bg-emerald-400 animate-pulse" />
                      <span>Ollama Cloud Connected (https://ollama.com)</span>
                    </span>
                  )}
                </div>

                {/* Whitelisted Models from Settings */}
                {availableModels.length > 0 && (
                  <div className="space-y-1.5">
                    <span className="text-[11px] font-bold uppercase tracking-wider text-slate-400 font-mono block">
                      Your Configured &amp; Whitelisted Models ({availableModels.length})
                    </span>
                    <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 gap-2">
                      {availableModels.map((m) => (
                        <button
                          key={m.id}
                          type="button"
                          onClick={() => setModelPreset(m.id)}
                          className={`px-3 py-2 rounded-xl border text-xs text-left font-medium transition-all cursor-pointer ${
                            modelPreset === m.id
                              ? "bg-amber-950/80 border-amber-500 text-amber-300 shadow-md ring-2 ring-amber-500/30 font-bold glow-amber-btn"
                              : "bg-slate-900 border-slate-800 text-slate-300 hover:border-amber-500/40 hover:bg-slate-800/80"
                          }`}
                        >
                          <div className="font-bold truncate">{m.display_name || m.id}</div>
                          <div className={`text-[10px] font-mono truncate mt-0.5 ${modelPreset === m.id ? "text-amber-400" : "text-slate-500"}`}>
                            {m.provider} &bull; {m.id}
                          </div>
                        </button>
                      ))}
                    </div>
                  </div>
                )}

                {/* Standard Cloud Presets */}
                <div className="space-y-1.5 pt-1">
                  <span className="text-[11px] font-bold uppercase tracking-wider text-slate-400 font-mono block">
                    Standard Cloud Presets
                  </span>
                  <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 gap-2">
                    {MODEL_PRESETS.map((m) => (
                      <button
                        key={m.id}
                        type="button"
                        onClick={() => setModelPreset(m.id)}
                        className={`px-3 py-2 rounded-xl border text-xs text-left font-medium transition-all cursor-pointer ${
                          modelPreset === m.id
                            ? "bg-amber-950/80 border-amber-500 text-amber-300 shadow-md ring-2 ring-amber-500/30 font-bold glow-amber-btn"
                            : "bg-slate-900 border-slate-800 text-slate-300 hover:border-amber-500/40 hover:bg-slate-800/80"
                        }`}
                      >
                        {m.label}
                      </button>
                    ))}
                  </div>
                </div>

                {modelPreset === "custom" && (
                  <input
                    type="text"
                    value={customModel}
                    onChange={(e) => setCustomModel(e.target.value)}
                    placeholder="e.g. ollama/deepseek-v4.1-flash, openai/gpt-4o-mini"
                    className="w-full px-3.5 py-2.5 bg-slate-900/90 border border-slate-700 rounded-xl text-sm text-slate-100 placeholder-slate-500 focus:outline-none focus:border-amber-500 focus:bg-slate-900 focus:ring-2 focus:ring-amber-500/20 font-mono transition-all mt-1"
                  />
                )}
              </div>

              {/* Reasoning Effort */}
              <div className="space-y-2">
                <label className="block text-xs font-semibold text-slate-300">
                  Reasoning Effort
                </label>
                <div className="inline-flex rounded-xl bg-slate-900 p-1 border border-slate-800 text-xs gap-1">
                  {(["low", "medium", "high"] as const).map((eff) => (
                    <button
                      key={eff}
                      type="button"
                      onClick={() => setReasoningEffort(eff)}
                      className={`px-4 py-1.5 rounded-lg capitalize font-bold transition-all cursor-pointer ${
                        reasoningEffort === eff
                          ? "bg-gradient-to-r from-amber-500 to-amber-600 text-slate-950 font-extrabold shadow-xs"
                          : "text-slate-400 hover:text-slate-200"
                      }`}
                    >
                      {eff}
                    </button>
                  ))}
                </div>
                <p className="text-[11px] text-slate-400">
                  Controls thinking budget per LLM call. <strong>High</strong> = deeper reasoning but more tokens.
                </p>
              </div>
            </div>
          )}

          {/* MODE 2: MULTI-MODEL SWARM ROUTING */}
          {routingMode === "swarm" && (
            <div className="space-y-5">
              {/* Swarm Quick Presets */}
              <div className="space-y-2">
                <div className="flex items-center justify-between">
                  <span className="text-xs font-bold text-slate-300 font-mono uppercase tracking-wider flex items-center space-x-1.5">
                    <Zap className="w-3.5 h-3.5 text-amber-400" />
                    <span>Swarm Composition Architecture</span>
                  </span>
                  <span className="text-[11px] text-slate-400">One-click stage assignments</span>
                </div>
                <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-4 gap-2.5">
                  {[
                    {
                      id: "balanced",
                      name: "⚡ Balanced Hybrid",
                      desc: "Gemini Flash (Recon) → Claude 3.5 Sonnet (Research) → GPT-4o (Critic)",
                      badge: "Recommended",
                    },
                    {
                      id: "adversarial",
                      name: "🛡️ Adversarial Check",
                      desc: "Claude Researcher vs. GPT-4o Critic (slashes consensus blindspots)",
                      badge: "Zero-FP Focus",
                    },
                    {
                      id: "budget",
                      name: "💰 Budget Optimized",
                      desc: "Gemini 3.5 Flash-Lite & Flash across all reconnaissance & research sweeps",
                      badge: "Cost Saver",
                    },
                    {
                      id: "frontier",
                      name: "🚀 Frontier Reasoning",
                      desc: "Claude 3.5 Sonnet & GPT-4o across all indexing, audit, critic & PoC passes",
                      badge: "Max Depth",
                    },
                  ].map((ps) => (
                    <button
                      key={ps.id}
                      type="button"
                      onClick={() => applySwarmPreset(ps.id)}
                      className={`p-3 rounded-xl border text-left transition-all cursor-pointer flex flex-col justify-between ${
                        swarmPreset === ps.id
                          ? "bg-amber-950/80 border-amber-500 text-amber-300 ring-2 ring-amber-500/30 glow-amber-btn"
                          : "bg-slate-900 border-slate-800 text-slate-300 hover:border-amber-500/40 hover:bg-slate-800/80"
                      }`}
                    >
                      <div>
                        <div className="flex items-center justify-between">
                          <span className="text-xs font-bold font-mono">{ps.name}</span>
                          <span className="text-[9px] px-1.5 py-0.2 rounded font-semibold bg-slate-950 text-slate-300 border border-slate-800">
                            {ps.badge}
                          </span>
                        </div>
                        <p className="text-[10px] text-slate-400 mt-1 line-clamp-2">{ps.desc}</p>
                      </div>
                    </button>
                  ))}
                </div>
              </div>

              {/* Swarm Interactive Allocation Matrix */}
              <div className="space-y-3">
                {/* Switcher & Header */}
                <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
                  <div>
                    <span className="text-xs font-bold text-white font-mono uppercase tracking-wider flex items-center space-x-1.5">
                      <Sliders className="w-3.5 h-3.5 text-amber-400" />
                      <span>Autonomous Swarm Model &amp; Reasoning Matrix</span>
                    </span>
                    <p className="text-[11px] text-slate-400 mt-0.5">
                      {swarmConfigMode === "squads"
                        ? "Configure functional security squads (macro allocation)"
                        : "Configure each autonomous LLM agent individually (granular allocation)"}
                    </p>
                  </div>

                  <div className="flex items-center space-x-1 bg-slate-950 p-1 rounded-xl border border-slate-800 shrink-0">
                    <button
                      type="button"
                      onClick={() => setSwarmConfigMode("squads")}
                      className={`px-3 py-1.5 rounded-lg text-xs font-mono font-bold transition-all cursor-pointer flex items-center space-x-1.5 ${
                        swarmConfigMode === "squads"
                          ? "bg-amber-500 text-slate-950 shadow-xs glow-amber-btn"
                          : "text-slate-400 hover:text-white"
                      }`}
                    >
                      <Layers className="w-3.5 h-3.5" />
                      <span>5 Squads</span>
                    </button>
                    <button
                      type="button"
                      onClick={() => setSwarmConfigMode("agents")}
                      className={`px-3 py-1.5 rounded-lg text-xs font-mono font-bold transition-all cursor-pointer flex items-center space-x-1.5 ${
                        swarmConfigMode === "agents"
                          ? "bg-amber-500 text-slate-950 shadow-xs glow-amber-btn"
                          : "text-slate-400 hover:text-white"
                      }`}
                    >
                      <Cpu className="w-3.5 h-3.5" />
                      <span>All 15 Agents</span>
                    </button>
                  </div>
                </div>

                {/* 4 Deterministic Routing Gates Banner */}
                <div className="p-3 rounded-xl bg-slate-950/80 border border-slate-800/80 flex flex-col sm:flex-row sm:items-center justify-between gap-3 text-xs">
                  <div className="flex items-start sm:items-center space-x-2.5">
                    <div className="p-1.5 rounded-lg bg-emerald-500/10 border border-emerald-500/30 text-emerald-400 shrink-0 mt-0.5 sm:mt-0">
                      <Box className="w-4 h-4" />
                    </div>
                    <div>
                      <div className="flex items-center space-x-2">
                        <span className="font-bold text-white font-mono">4 Deterministic Classifiers &amp; Routing Gates</span>
                        <span className="text-[10px] font-mono px-2 py-0.2 rounded font-semibold bg-emerald-950/70 text-emerald-300 border border-emerald-800/80">
                          0 Tokens &bull; $0.00 &bull; Deterministic
                        </span>
                      </div>
                      <p className="text-[11px] text-slate-400 mt-0.5 font-mono">
                        <span className="text-slate-300">07 findings_gate</span> &bull; <span className="text-slate-300">10 reviewer_classifier</span> &bull; <span className="text-slate-300">12 critic_classifier</span> &bull; <span className="text-slate-300">14 repro_classifier</span>
                      </p>
                    </div>
                  </div>
                  <span className="text-[10px] text-slate-500 font-mono hidden md:inline">Pure Python Routing</span>
                </div>

                {/* VIEW A: 5 SQUADS */}
                {swarmConfigMode === "squads" && (
                  <div className="space-y-2.5">
                    {SWARM_SQUADS.map((st) => {
                      const assignedModel = phaseModels[st.key] || "gemini/gemini-3.5-flash-lite";
                      const assignedEffort = phaseEfforts[st.key] || "medium";
                      const isCustom = assignedModel === "custom" || customStageModels[st.key];

                      return (
                        <div
                          key={st.key}
                          className="p-3.5 rounded-xl bg-slate-900/90 border border-slate-800 hover:border-slate-700 transition-all flex flex-col lg:flex-row lg:items-center justify-between gap-3"
                        >
                          {/* Squad Info */}
                          <div className="min-w-[260px] max-w-sm">
                            <div className="flex items-center space-x-2">
                              <span className="px-1.5 py-0.5 rounded text-[10px] font-mono font-black bg-amber-950 text-amber-400 border border-amber-800/80">
                                {st.num}
                              </span>
                              <span className="text-xs font-bold text-white font-mono">{st.name}</span>
                            </div>
                            <p className="text-[10px] text-slate-400 mt-1 leading-relaxed">
                              {st.desc}
                            </p>
                            <div className="mt-1 flex flex-wrap items-center gap-1">
                              <span className="text-[9px] font-mono text-slate-500">Agents:</span>
                              <span className="text-[9px] font-mono text-amber-300/80 bg-slate-950 px-1.5 py-0.2 rounded border border-slate-800">
                                {st.nodes}
                              </span>
                              {st.gates && (
                                <span className="text-[9px] font-mono text-emerald-400 bg-emerald-950/40 px-1.5 py-0.2 rounded border border-emerald-800/40">
                                  {st.gates}
                                </span>
                              )}
                            </div>
                          </div>

                          {/* Model & Reasoning Controls */}
                          <div className="flex flex-wrap items-center gap-2.5">
                            {/* Model Select */}
                            <div className="flex flex-col space-y-1">
                              <select
                                value={isCustom ? "custom" : assignedModel}
                                onChange={(e) => {
                                  const val = e.target.value;
                                  if (val === "custom") {
                                    setCustomStageModels((prev) => ({ ...prev, [st.key]: "openai/gpt-4o" }));
                                    handleSquadModelChange(st.key, customStageModels[st.key] || "openai/gpt-4o", st.agentIds);
                                  } else {
                                    setCustomStageModels((prev) => ({ ...prev, [st.key]: "" }));
                                    handleSquadModelChange(st.key, val, st.agentIds);
                                  }
                                }}
                                className="px-2.5 py-1.5 bg-slate-950 border border-slate-700 rounded-lg text-xs font-mono text-amber-300 focus:outline-none focus:border-amber-500 focus:ring-1 focus:ring-amber-500/30"
                              >
                                <optgroup label="Whitelisted Models">
                                  {availableModels.map((m) => (
                                    <option key={`wl_${st.key}_${m.id}`} value={m.id}>
                                      {m.display_name || m.id} ({m.provider})
                                    </option>
                                  ))}
                                </optgroup>
                                <optgroup label="Standard Cloud Models">
                                  {MODEL_PRESETS.filter((p) => p.id !== "custom").map((p) => (
                                    <option key={`std_${st.key}_${p.id}`} value={p.id}>
                                      {p.label}
                                    </option>
                                  ))}
                                </optgroup>
                                <option value="custom">✏️ Custom Model ID...</option>
                              </select>

                              {isCustom && (
                                <input
                                  type="text"
                                  value={customStageModels[st.key] || ""}
                                  onChange={(e) => {
                                    const val = e.target.value;
                                    setCustomStageModels((prev) => ({ ...prev, [st.key]: val }));
                                    handleSquadModelChange(st.key, val, st.agentIds);
                                  }}
                                  placeholder="e.g. anthropic/claude-3-5-haiku"
                                  className="px-2 py-1 bg-slate-950 border border-slate-700 rounded text-[11px] font-mono text-slate-200 focus:outline-none focus:border-amber-500"
                                />
                              )}
                            </div>

                            {/* Reasoning Effort Pills */}
                            <div className="flex items-center space-x-1 bg-slate-950 p-1 rounded-lg border border-slate-800 text-[10px] font-mono font-bold">
                              {(["low", "medium", "high"] as const).map((eff) => (
                                <button
                                  key={`eff_${st.key}_${eff}`}
                                  type="button"
                                  onClick={() => handleSquadEffortChange(st.key, eff, st.agentIds)}
                                  className={`px-2 py-0.5 rounded capitalize transition-all cursor-pointer ${
                                    assignedEffort === eff
                                      ? "bg-amber-500 text-slate-950 font-black shadow-xs"
                                      : "text-slate-400 hover:text-slate-200"
                                  }`}
                                >
                                  {eff}
                                </button>
                              ))}
                            </div>
                          </div>
                        </div>
                      );
                    })}
                  </div>
                )}

                {/* VIEW B: ALL 15 INDIVIDUAL AGENTS */}
                {swarmConfigMode === "agents" && (
                  <div className="space-y-2 max-h-[600px] overflow-y-auto pr-1">
                    {SWARM_15_AGENTS.map((ag) => {
                      const isDeterministic = Boolean(ag.isDeterministic);
                      const assignedModel = phaseModels[ag.id] || "gemini/gemini-3.5-flash-lite";
                      const assignedEffort = phaseEfforts[ag.id] || "medium";
                      const isCustom = assignedModel === "custom" || customStageModels[ag.id];

                      return (
                        <div
                          key={ag.id}
                          className={`p-3 rounded-xl border transition-all flex flex-col lg:flex-row lg:items-center justify-between gap-3 ${
                            isDeterministic
                              ? "bg-slate-950/70 border-emerald-900/40"
                              : "bg-slate-900/90 border-slate-800 hover:border-slate-700"
                          }`}
                        >
                          {/* Agent Info */}
                          <div className="min-w-[260px] max-w-sm">
                            <div className="flex items-center space-x-2">
                              <span className="px-1.5 py-0.5 rounded text-[10px] font-mono font-black bg-amber-950 text-amber-400 border border-amber-800/80">
                                {ag.num}
                              </span>
                              <span className="text-xs font-bold text-white font-mono">{ag.name}</span>
                              <span className="text-[9px] font-mono text-slate-400 bg-slate-950 px-1.5 py-0.2 rounded border border-slate-800">
                                {ag.squadName}
                              </span>
                            </div>
                            <p className="text-[10px] text-slate-400 mt-1 leading-relaxed">
                              {ag.desc}
                            </p>
                          </div>

                          {/* Controls or Deterministic Pill */}
                          {isDeterministic ? (
                            <div className="flex items-center space-x-2">
                              <span className="px-3 py-1.5 rounded-lg bg-emerald-950/60 border border-emerald-800/80 text-emerald-300 font-mono text-[11px] font-bold flex items-center space-x-1.5">
                                <span className="w-1.5 h-1.5 rounded-full bg-emerald-400"></span>
                                <span>Tree-Sitter AST (Zero-LLM &bull; 0 Tokens &bull; Free)</span>
                              </span>
                              <span className="text-[10px] font-mono text-slate-500 bg-slate-950 px-2 py-1 rounded border border-slate-800">
                                Effort: N/A
                              </span>
                            </div>
                          ) : (
                            <div className="flex flex-wrap items-center gap-2.5">
                              {/* Model Select */}
                              <div className="flex flex-col space-y-1">
                                <select
                                  value={isCustom ? "custom" : assignedModel}
                                  onChange={(e) => {
                                    const val = e.target.value;
                                    if (val === "custom") {
                                      setCustomStageModels((prev) => ({ ...prev, [ag.id]: "openai/gpt-4o" }));
                                      setPhaseModels((prev) => ({ ...prev, [ag.id]: customStageModels[ag.id] || "openai/gpt-4o" }));
                                    } else {
                                      setCustomStageModels((prev) => ({ ...prev, [ag.id]: "" }));
                                      setPhaseModels((prev) => ({ ...prev, [ag.id]: val }));
                                    }
                                  }}
                                  className="px-2.5 py-1.5 bg-slate-950 border border-slate-700 rounded-lg text-xs font-mono text-amber-300 focus:outline-none focus:border-amber-500 focus:ring-1 focus:ring-amber-500/30"
                                >
                                  <optgroup label="Whitelisted Models">
                                    {availableModels.map((m) => (
                                      <option key={`wl_${ag.id}_${m.id}`} value={m.id}>
                                        {m.display_name || m.id} ({m.provider})
                                      </option>
                                    ))}
                                  </optgroup>
                                  <optgroup label="Standard Cloud Models">
                                    {MODEL_PRESETS.filter((p) => p.id !== "custom").map((p) => (
                                      <option key={`std_${ag.id}_${p.id}`} value={p.id}>
                                        {p.label}
                                      </option>
                                    ))}
                                  </optgroup>
                                  <option value="custom">✏️ Custom Model ID...</option>
                                </select>

                                {isCustom && (
                                  <input
                                    type="text"
                                    value={customStageModels[ag.id] || ""}
                                    onChange={(e) => {
                                      const val = e.target.value;
                                      setCustomStageModels((prev) => ({ ...prev, [ag.id]: val }));
                                      setPhaseModels((prev) => ({ ...prev, [ag.id]: val }));
                                    }}
                                    placeholder="e.g. anthropic/claude-3-5-haiku"
                                    className="px-2 py-1 bg-slate-950 border border-slate-700 rounded text-[11px] font-mono text-slate-200 focus:outline-none focus:border-amber-500"
                                  />
                                )}
                              </div>

                              {/* Reasoning Effort Pills */}
                              <div className="flex items-center space-x-1 bg-slate-950 p-1 rounded-lg border border-slate-800 text-[10px] font-mono font-bold">
                                {((["low", "medium", "high"] as const)).map((eff) => (
                                  <button
                                    key={`eff_${ag.id}_${eff}`}
                                    type="button"
                                    onClick={() => setPhaseEfforts((prev) => ({ ...prev, [ag.id]: eff }))}
                                    className={`px-2 py-0.5 rounded capitalize transition-all cursor-pointer ${
                                      assignedEffort === eff
                                        ? "bg-amber-500 text-slate-950 font-black shadow-xs"
                                        : "text-slate-400 hover:text-slate-200"
                                    }`}
                                  >
                                    {eff}
                                  </button>
                                ))}
                              </div>
                            </div>
                          )}
                        </div>
                      );
                    })}
                  </div>
                )}

                <div className="p-3 rounded-xl bg-amber-950/30 border border-amber-900/50 flex items-start space-x-2.5 text-xs text-amber-200/90 leading-relaxed font-sans">
                  <Info className="w-4 h-4 text-amber-400 shrink-0 mt-0.5" />
                  <div>
                    <strong>Heterogeneous Cross-Vendor Execution:</strong> MantisVision routes requests via LiteLLM. For example, pairing a <em>Claude Vulnerability Researcher</em> with an <em>OpenAI GPT-4o Adversarial Critic</em> introduces orthogonal cognitive architectures that falsify spurious hypotheses while confirming true exploit chains!
                  </div>
                </div>
              </div>
            </div>
          )}

          {/* Focus */}
          <div className="space-y-2">
            <div className="flex items-center justify-between">
              <label className="text-xs font-bold text-slate-200 flex items-center space-x-1.5">
                <Search className="w-3.5 h-3.5 text-amber-400" />
                <span>Focus Directive (--focus)</span>
                <span className="text-[10px] font-mono font-semibold bg-amber-950/80 text-amber-300 px-2 py-0.5 rounded-full border border-amber-800/80">
                  Tactical CWE Filter
                </span>
              </label>
              <span className="text-[11px] text-slate-500 font-normal">Optional</span>
            </div>
            <input
              type="text"
              value={focus}
              onChange={(e) => setFocus(e.target.value)}
              placeholder="e.g. SQL injection, SSRF, IDOR, deserialization, command injection"
              className="w-full px-3.5 py-2.5 bg-slate-900/90 border border-slate-700 rounded-xl text-sm text-slate-100 placeholder-slate-500 focus:outline-none focus:border-amber-500 focus:bg-slate-900 focus:ring-2 focus:ring-amber-500/20 font-mono transition-all"
            />
            <div className="text-[11px] text-slate-400 leading-relaxed space-y-1">
              <p>
                <strong>Tactical CWE Filter:</strong> Directs the hypothesis generator and critic swarms to isolate specific vulnerability classes or attack vectors.
              </p>
              <div className="text-[11px] text-amber-200 bg-amber-950/40 rounded-xl p-2.5 border border-amber-800/60 flex items-start space-x-2">
                <Info className="w-3.5 h-3.5 text-amber-400 shrink-0 mt-0.5" />
                <span>
                  <strong>Focus vs Objective:</strong> <em>Focus</em> restricts <strong>what defect classes</strong> are hunted (e.g., SQLi, SSRF, IDOR). <em>Objective</em> (under Advanced Flags below) guides <strong>what attacker goal</strong> to achieve (e.g., unauthenticated privilege escalation to tenant admin).
                </span>
              </div>
            </div>
          </div>

          {/* Exclude Patterns */}
          <div className="space-y-2">
            <label className="block text-xs font-semibold text-slate-300 flex items-center space-x-1">
              <Filter className="w-3.5 h-3.5 text-slate-400" />
              <span>Exclude Patterns</span>
              <span className="text-[11px] text-slate-500 font-normal ml-1">Comma-separated, optional</span>
            </label>
            <input
              type="text"
              value={excludePatterns}
              onChange={(e) => setExcludePatterns(e.target.value)}
              placeholder="e.g. vendor, testdata, *.min.js, node_modules"
              className="w-full px-3.5 py-2.5 bg-slate-900/90 border border-slate-700 rounded-xl text-sm text-slate-100 placeholder-slate-500 focus:outline-none focus:border-amber-500 focus:bg-slate-900 focus:ring-2 focus:ring-amber-500/20 font-mono transition-all"
            />
          </div>

          {/* Sandbox Mode */}
          <div className="space-y-2">
            <label className="block text-xs font-semibold text-slate-300 flex items-center space-x-1">
              <Box className="w-3.5 h-3.5 text-slate-400" />
              <span>Sandbox Mode</span>
            </label>
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-2">
              {SANDBOX_OPTIONS.map((opt) => (
                <button
                  key={opt.id}
                  type="button"
                  onClick={() => setSandbox(opt.id)}
                  className={`p-3 rounded-xl border text-left transition-all cursor-pointer ${
                    sandbox === opt.id
                      ? "bg-amber-950/80 border-amber-500 text-amber-300 ring-2 ring-amber-500/30 glow-amber-btn"
                      : "bg-slate-900 border-slate-800 text-slate-300 hover:border-amber-500/40"
                  }`}
                >
                  <div className={`font-bold text-xs ${sandbox === opt.id ? "text-amber-300" : "text-white"}`}>
                    {opt.label}
                  </div>
                  <div className={`text-[10px] mt-0.5 ${sandbox === opt.id ? "text-amber-400" : "text-slate-400"}`}>
                    {opt.desc}
                  </div>
                </button>
              ))}
            </div>
          </div>

          {/* Token Budget */}
          <div className="space-y-2">
            <label className="block text-xs font-semibold text-slate-300 flex items-center justify-between">
              <span>Token Budget Ceiling</span>
              <span className="text-[11px] text-slate-500 font-normal">Optional</span>
            </label>
            <input
              type="number"
              value={maxTokens}
              onChange={(e) => setMaxTokens(e.target.value ? parseInt(e.target.value) : "")}
              placeholder="e.g. 500000 (leave blank for no limit)"
              min={10000}
              step={10000}
              className="w-full px-3.5 py-2.5 bg-slate-900/90 border border-slate-700 rounded-xl text-sm text-slate-100 placeholder-slate-500 focus:outline-none focus:border-amber-500 focus:bg-slate-900 focus:ring-2 focus:ring-amber-500/20 font-mono transition-all"
            />
          </div>

          {/* Resume */}
          <label className="flex items-start space-x-3 cursor-pointer group pt-1 border-t border-slate-800">
            <input
              type="checkbox"
              checked={resumeScan}
              onChange={(e) => setResumeScan(e.target.checked)}
              className="mt-0.5 h-4 w-4 rounded border-slate-700 text-amber-500 focus:ring-amber-500 accent-amber-500 cursor-pointer"
            />
            <div className="space-y-0.5">
              <div className="flex items-center space-x-1.5">
                <RefreshCw className="w-3.5 h-3.5 text-amber-400" />
                <span className="text-xs font-bold text-white group-hover:text-amber-300 transition-colors">
                  Resume from Last Checkpoint
                </span>
              </div>
              <p className="text-[11px] text-slate-400 leading-relaxed">
                If a previous scan workspace exists for this target, resume from where it left off rather than starting fresh.
              </p>
            </div>
          </label>

          {/* Advanced Engine Controls Toggle */}
          <div className="pt-3 border-t border-slate-800">
            <button
              type="button"
              onClick={() => setShowAdvancedEngine(!showAdvancedEngine)}
              className="flex items-center justify-between w-full py-1 text-xs font-bold text-amber-400 hover:text-amber-300 font-mono cursor-pointer"
            >
              <div className="flex items-center space-x-2">
                <Sliders className="w-3.5 h-3.5" />
                <span>Advanced Engine Execution Flags ({showAdvancedEngine ? "Hide" : "Show"})</span>
              </div>
              <span className="text-[10px] font-mono bg-amber-950/60 px-2 py-0.5 rounded text-amber-300 border border-amber-800/60">
                mode: {scanMode} | {parallel} worker(s)
              </span>
            </button>

            {showAdvancedEngine && (
              <div className="mt-4 space-y-4 p-4 rounded-xl bg-slate-950/90 border border-slate-800">
                {/* Scan Mode */}
                <div className="space-y-1.5">
                  <label className="block text-xs font-semibold text-slate-300">
                    Scan Mode (--scan-mode)
                  </label>
                  <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
                    {[
                      { id: "auto", label: "Auto", desc: "Adaptive campaign plan" },
                      { id: "whole", label: "Whole", desc: "Entire repo single graph" },
                      { id: "file-by-file", label: "File-by-File", desc: "Isolated single-file hunt" },
                      { id: "cross-functional", label: "Cross-Functional", desc: "Multi-file defect chaining" },
                    ].map((m) => (
                      <button
                        key={m.id}
                        type="button"
                        onClick={() => setScanMode(m.id as any)}
                        className={`p-2.5 rounded-lg border text-left text-xs transition-all cursor-pointer ${
                          scanMode === m.id
                            ? "bg-amber-950/80 border-amber-500 text-amber-300 font-bold"
                            : "bg-slate-900 border-slate-800 text-slate-400 hover:border-slate-700"
                        }`}
                      >
                        <div className="font-bold">{m.label}</div>
                        <div className={`text-[10px] mt-0.5 ${scanMode === m.id ? "text-amber-400" : "text-slate-500"}`}>
                          {m.desc}
                        </div>
                      </button>
                    ))}
                  </div>
                </div>

                {/* Campaign Objective */}
                <div className="space-y-1.5">
                  <div className="flex items-center justify-between">
                    <label className="text-xs font-bold text-slate-200 flex items-center space-x-1.5">
                      <Crosshair className="w-3.5 h-3.5 text-cyan-400" />
                      <span>Natural Language Objective (--objective)</span>
                      <span className="text-[10px] font-mono font-semibold bg-cyan-950/80 text-cyan-300 px-2 py-0.5 rounded-full border border-cyan-800/80">
                        Strategic Scenario Goal
                      </span>
                    </label>
                    <span className="text-[10px] text-slate-500">Optional</span>
                  </div>
                  <input
                    type="text"
                    value={objective}
                    onChange={(e) => setObjective(e.target.value)}
                    placeholder="e.g. Find privilege escalation from unauthenticated visitor to tenant admin"
                    className="w-full px-3 py-2 bg-slate-900 border border-slate-700 rounded-xl text-xs font-mono text-slate-100 focus:outline-none focus:border-amber-500"
                  />
                  <div className="text-[10px] text-slate-400 space-y-1 leading-relaxed">
                    <p>
                      <strong>Strategic Campaign Goal:</strong> Steers multi-agent research graph synthesis toward an attacker mission outcome.
                    </p>
                    <div className="text-indigo-200 bg-indigo-950/40 rounded-lg p-2 border border-indigo-800/60 flex items-start space-x-1.5">
                      <Info className="w-3 h-3 text-indigo-400 shrink-0 mt-0.5" />
                      <span>
                        <strong>Objective vs Focus:</strong> <em>Objective</em> steers <strong>attacker business logic milestones</strong> (e.g., reaching admin panel without MFA). <em>Focus</em> (above) specifies <strong>detector bug classes</strong> (e.g., SQLi, SSRF).
                      </span>
                    </div>
                  </div>
                </div>

                {/* Seed Report */}
                <div className="space-y-1.5">
                  <label className="block text-xs font-semibold text-slate-300">
                    Variant Bug Hunting Report (--seed-report)
                  </label>
                  <input
                    type="text"
                    value={seedReport}
                    onChange={(e) => setSeedReport(e.target.value)}
                    placeholder="e.g. /app/reports/cve-2024-1234.md"
                    className="w-full px-3 py-2 bg-slate-900 border border-slate-700 rounded-xl text-xs font-mono text-slate-100 focus:outline-none focus:border-amber-500"
                  />
                  <p className="text-[10px] text-slate-400 font-mono">
                    Path to a prior bug report; the swarm will search for structural variants of the reported bug.
                  </p>
                </div>

                {/* Grid for Parallel & Limits */}
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                  <div className="space-y-1.5">
                    <label className="block text-xs font-semibold text-slate-300">
                      Parallel Campaigns Concurrency (--parallel)
                    </label>
                    <input
                      type="number"
                      min={1}
                      max={10}
                      value={parallel}
                      onChange={(e) => setParallel(parseInt(e.target.value) || 1)}
                      className="w-full px-3 py-2 bg-slate-900 border border-slate-700 rounded-xl text-xs font-mono text-slate-100 focus:border-amber-500"
                    />
                  </div>

                  <div className="space-y-1.5">
                    <label className="block text-xs font-semibold text-slate-300">
                      Max LLM Calls Ceiling (--max-llm-calls)
                    </label>
                    <input
                      type="number"
                      min={1}
                      value={maxLlmCalls}
                      onChange={(e) => setMaxLlmCalls(e.target.value ? parseInt(e.target.value) : "")}
                      placeholder="e.g. 100 (leave blank for workflow default)"
                      className="w-full px-3 py-2 bg-slate-900 border border-slate-700 rounded-xl text-xs font-mono text-slate-100 focus:border-amber-500"
                    />
                  </div>
                </div>

                {/* Toggles */}
                <div className="pt-2 border-t border-slate-800 space-y-2">
                  <label className="flex items-center space-x-2 text-xs font-medium text-slate-300 cursor-pointer">
                    <input
                      type="checkbox"
                      checked={deterministicOnly}
                      onChange={(e) => setDeterministicOnly(e.target.checked)}
                      className="rounded border-slate-700 text-amber-500 focus:ring-amber-500 accent-amber-500"
                    />
                    <span>Force Deterministic Archetype Synthesis (--deterministic-only)</span>
                  </label>

                  <label className="flex items-center space-x-2 text-xs font-medium text-slate-300 cursor-pointer">
                    <input
                      type="checkbox"
                      checked={noReplan}
                      onChange={(e) => setNoReplan(e.target.checked)}
                      className="rounded border-slate-700 text-amber-500 focus:ring-amber-500 accent-amber-500"
                    />
                    <span>Freeze Campaign Plan at Start (--no-replan) for exact reproducibility</span>
                  </label>
                </div>
              </div>
            )}
          </div>
        </div>

        {/* Section 3: Hard Cost Ceiling */}
        <div className="glass-card rounded-2xl p-6 space-y-5 shadow-xl">
          <div className="flex items-center justify-between border-b border-slate-800 pb-3">
            <h2 className="text-sm font-bold text-white flex items-center space-x-2">
              <DollarSign className="w-4 h-4 text-amber-400" />
              <span>Hard Cost Ceiling</span>
            </h2>
            <span className="px-3 py-1 rounded-full text-xs font-bold text-amber-300 bg-amber-950/80 border border-amber-800/80 font-mono glow-amber-btn">
              ${budgetLimit.toFixed(2)} USD
            </span>
          </div>

          <div>
            <input
              type="range"
              min="0.50"
              max="20.00"
              step="0.50"
              value={budgetLimit}
              onChange={(e) => setBudgetLimit(parseFloat(e.target.value))}
              className="w-full accent-amber-500 cursor-pointer"
            />
            <div className="flex justify-between text-[11px] text-slate-400 mt-1.5 font-medium font-mono">
              <span>$0.50 (Frugal)</span>
              <span>$5.00 (Standard)</span>
              <span>$10.00 (Deep Multi-Pass)</span>
              <span>$20.00 (Max)</span>
            </div>
          </div>
          <p className="text-[11px] text-slate-400">
            If this audit exceeds the specified cost ceiling, the execution pipeline immediately halts with a{" "}
            <code className="text-amber-300 font-bold bg-amber-950/80 px-1 py-0.5 rounded border border-amber-800/60 font-mono">budget_exceeded</code> safety state.
          </p>
        </div>

        {/* Section 4: Audit Mode & Knowledge Base Reset */}
        <div className="glass-card rounded-2xl p-6 space-y-4 shadow-xl">
          <div className="flex items-center justify-between border-b border-slate-800 pb-3">
            <h2 className="text-sm font-bold text-white flex items-center space-x-2">
              <Sparkles className="w-4 h-4 text-amber-400" />
              <span>Audit Mode &amp; Knowledge Base Reset</span>
            </h2>
          </div>
          <label className="flex items-start space-x-3 cursor-pointer group">
            <input
              type="checkbox"
              checked={freshScan}
              onChange={(e) => setFreshScan(e.target.checked)}
              className="mt-0.5 h-4 w-4 rounded border-slate-700 text-amber-500 focus:ring-amber-500 accent-amber-500 cursor-pointer"
            />
            <div className="space-y-0.5">
              <span className="text-xs font-bold text-white group-hover:text-amber-300 transition-colors">
                Fresh Baseline Scan (Clean Slate)
              </span>
              <p className="text-[11px] text-slate-400 leading-relaxed">
                Purge and ignore any historical learnings, past reflections, or archived findings for this repository. The swarm will treat this as a brand-new first-time scan rather than a continuation pass.
              </p>
            </div>
          </label>
        </div>

        {/* Submit */}
        <button
          type="submit"
          disabled={loading}
          className="w-full py-3.5 px-4 bg-gradient-to-r from-amber-500 via-amber-500 to-amber-600 hover:from-amber-400 hover:to-amber-500 disabled:opacity-50 text-slate-950 font-extrabold text-sm rounded-xl flex items-center justify-center space-x-2 transition-all shadow-lg shadow-amber-500/25 hover:-translate-y-0.5 cursor-pointer glow-amber-btn"
        >
          <Play className="w-4 h-4 fill-current" />
          <span>{loading ? "Initializing Scan Pipeline..." : "Start Autonomous Audit"}</span>
        </button>
      </form>
    </div>
  );
}
