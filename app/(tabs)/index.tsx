import React, { useState, useEffect, useCallback, useRef } from "react";
import {
  StyleSheet,
  Text,
  View,
  FlatList,
  TextInput,
  TouchableOpacity,
  Alert,
  Platform,
  Modal,
  ScrollView,
  StatusBar,
  Animated,
  Dimensions,
  Switch,
} from "react-native";
import AsyncStorage from "@react-native-async-storage/async-storage";
import DateTimePickerModal from "react-native-modal-datetime-picker";
import { LinearGradient } from "expo-linear-gradient";

// ─── Types ────────────────────────────────────────────────────────────────────

type Priority = "low" | "medium" | "high";
type TabType = "tasks" | "analytics";
type FilterType =
  | "all"
  | "active"
  | "done"
  | "urgent"
  | "today"
  | string; // category name
type SortType = "created" | "deadline" | "priority" | "alpha";
type ViewType = "list" | "grid";

interface Todo {
  id: string;
  task: string;
  notes: string;
  startDate: string;
  endDate: string;
  color: string;
  category: string;
  priority: Priority;
  done: boolean;
  createdAt: number;
  order: number;
}

interface ColorOption {
  name: string;
  hex: string;
}

// ─── Constants ────────────────────────────────────────────────────────────────

const STORAGE_KEY = "@taskflow_v3";
const { width: SCREEN_WIDTH } = Dimensions.get("window");

const COLORS: ColorOption[] = [
  { name: "Violet", hex: "#7c6af7" },
  { name: "Emerald", hex: "#3ecf8e" },
  { name: "Rose", hex: "#f04444" },
  { name: "Amber", hex: "#f59e0b" },
  { name: "Blue", hex: "#3b82f6" },
  { name: "Pink", hex: "#ec4899" },
  { name: "Cyan", hex: "#06b6d4" },
  { name: "Purple", hex: "#a78bfa" },
  { name: "Teal", hex: "#34d399" },
  { name: "Orange", hex: "#fb923c" },
  { name: "Sky", hex: "#60a5fa" },
  { name: "Fuchsia", hex: "#f472b6" },
];

const CATEGORIES = [
  "Work",
  "Personal",
  "Health",
  "Learning",
  "Finance",
  "Creative",
  "Other",
];

const PRIORITY_COLORS: Record<Priority, string> = {
  high: "#f04444",
  medium: "#f59e0b",
  low: "#3ecf8e",
};

const PRIORITY_LABELS: Record<Priority, string> = {
  low: "↓ Low",
  medium: "→ Med",
  high: "↑ High",
};

// ─── Helpers ──────────────────────────────────────────────────────────────────

function genId(): string {
  return Date.now().toString(36) + Math.random().toString(36).slice(2);
}

function daysLeft(end: string): number {
  const now = new Date();
  now.setHours(0, 0, 0, 0);
  return Math.ceil((new Date(end).getTime() - now.getTime()) / 86400000);
}

function isToday(d: string): boolean {
  return d === new Date().toISOString().split("T")[0];
}

function progressPct(todo: Todo): number {
  if (todo.done) return 100;
  const start = new Date(todo.startDate).getTime();
  const end = new Date(todo.endDate).getTime();
  const now = Date.now();
  const total = end - start;
  if (total <= 0) return 100;
  return Math.min(Math.max(Math.round(((now - start) / total) * 100), 0), 100);
}

function statusInfo(todo: Todo): { label: string; color: string } {
  if (todo.done) return { label: "Done", color: "#3ecf8e" };
  if (isToday(todo.endDate)) return { label: "Due Today", color: "#3b82f6" };
  const d = daysLeft(todo.endDate);
  if (d < 0) return { label: `${Math.abs(d)}d overdue`, color: "#f04444" };
  if (d <= 2) return { label: `${d}d left`, color: "#f04444" };
  if (d <= 5) return { label: `${d}d left`, color: "#f59e0b" };
  return { label: `${d}d left`, color: "#3ecf8e" };
}

function todayStr(): string {
  return new Date().toISOString().split("T")[0];
}

// ─── Toast Component ──────────────────────────────────────────────────────────

interface ToastProps {
  message: string;
  type: "success" | "info" | "error";
  onHide: () => void;
}

const Toast: React.FC<ToastProps> = ({ message, type, onHide }) => {
  const opacity = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    Animated.sequence([
      Animated.timing(opacity, {
        toValue: 1,
        duration: 200,
        useNativeDriver: true,
      }),
      Animated.delay(2200),
      Animated.timing(opacity, {
        toValue: 0,
        duration: 300,
        useNativeDriver: true,
      }),
    ]).start(onHide);
  }, []);

  const bgColor =
    type === "success" ? "#3ecf8e" : type === "error" ? "#f04444" : "#7c6af7";
  const icon = type === "success" ? "✓" : type === "error" ? "✕" : "ℹ";

  return (
    <Animated.View style={[styles.toast, { opacity, borderLeftColor: bgColor }]}>
      <View style={[styles.toastIcon, { backgroundColor: bgColor + "22" }]}>
        <Text style={[styles.toastIconText, { color: bgColor }]}>{icon}</Text>
      </View>
      <Text style={styles.toastText}>{message}</Text>
    </Animated.View>
  );
};

// ─── Analytics Bar Component ──────────────────────────────────────────────────

interface AnalyticsBarProps {
  label: string;
  value: number;
  max: number;
  color: string;
}

const AnalyticsBar: React.FC<AnalyticsBarProps> = ({
  label,
  value,
  max,
  color,
}) => {
  const pct = max > 0 ? (value / max) * 100 : 0;
  return (
    <View style={styles.barRow}>
      <Text style={styles.barLabel} numberOfLines={1}>
        {label}
      </Text>
      <View style={styles.barTrack}>
        <View
          style={[styles.barFill, { width: `${pct}%` as any, backgroundColor: color }]}
        />
      </View>
      <Text style={styles.barVal}>{value}</Text>
    </View>
  );
};

// ─── Main App ─────────────────────────────────────────────────────────────────

export default function App() {
  // State
  const [todos, setTodos] = useState<Todo[]>([]);
  const [tab, setTab] = useState<TabType>("tasks");
  const [filter, setFilter] = useState<FilterType>("all");
  const [search, setSearch] = useState("");
  const [sort, setSort] = useState<SortType>("created");
  const [view, setView] = useState<ViewType>("list");
  const [selected, setSelected] = useState<Set<string>>(new Set());

  // Modal state
  const [modalVisible, setModalVisible] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [taskText, setTaskText] = useState("");
  const [notesText, setNotesText] = useState("");
  const [category, setCategory] = useState("");
  const [priority, setPriority] = useState<Priority>("medium");
  const [startDate, setStartDate] = useState(todayStr());
  const [endDate, setEndDate] = useState("");
  const [selectedColor, setSelectedColor] = useState(COLORS[0].hex);
  const [showStartPicker, setShowStartPicker] = useState(false);
  const [showEndPicker, setShowEndPicker] = useState(false);

  // UI
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const [analyticsTab, setAnalyticsTab] = useState<"overview" | "categories">(
    "overview"
  );
  const [toasts, setToasts] = useState<
    Array<{ id: string; message: string; type: "success" | "info" | "error" }>
  >([]);
  const sidebarAnim = useRef(new Animated.Value(-280)).current;

  // ─── Persistence ────────────────────────────────────────────────────────────

  useEffect(() => {
    (async () => {
      try {
        const raw = await AsyncStorage.getItem(STORAGE_KEY);
        if (raw) {
          const parsed = JSON.parse(raw);
          setTodos(parsed.todos || []);
        }
      } catch (e) {
        console.error("Load error:", e);
      }
    })();
  }, []);

  const saveTodos = useCallback(async (data: Todo[]) => {
    try {
      await AsyncStorage.setItem(STORAGE_KEY, JSON.stringify({ todos: data }));
    } catch (e) {
      console.error("Save error:", e);
    }
  }, []);

  // ─── Toast ──────────────────────────────────────────────────────────────────

  const showToast = (
    message: string,
    type: "success" | "info" | "error" = "info"
  ) => {
    const id = genId();
    setToasts((prev) => [...prev, { id, message, type }]);
  };

  const removeToast = (id: string) => {
    setToasts((prev) => prev.filter((t) => t.id !== id));
  };

  // ─── Sidebar animation ──────────────────────────────────────────────────────

  const openSidebar = () => {
    setSidebarOpen(true);
    Animated.spring(sidebarAnim, {
      toValue: 0,
      useNativeDriver: true,
      tension: 65,
      friction: 11,
    }).start();
  };

  const closeSidebar = () => {
    Animated.timing(sidebarAnim, {
      toValue: -280,
      duration: 220,
      useNativeDriver: true,
    }).start(() => setSidebarOpen(false));
  };

  // ─── Filtering & Sorting ────────────────────────────────────────────────────

  const filteredTodos = useCallback((): Todo[] => {
    let list = [...todos];
    if (filter === "done") list = list.filter((t) => t.done);
    else if (filter === "active") list = list.filter((t) => !t.done);
    else if (filter === "urgent")
      list = list.filter((t) => !t.done && daysLeft(t.endDate) <= 2);
    else if (filter === "today")
      list = list.filter((t) => !t.done && isToday(t.endDate));
    else if (filter !== "all") list = list.filter((t) => t.category === filter);

    if (search.trim()) {
      const q = search.toLowerCase();
      list = list.filter(
        (t) =>
          t.task.toLowerCase().includes(q) ||
          t.notes.toLowerCase().includes(q) ||
          t.category.toLowerCase().includes(q)
      );
    }

    if (sort === "created") list.sort((a, b) => b.createdAt - a.createdAt);
    else if (sort === "deadline")
      list.sort(
        (a, b) => new Date(a.endDate).getTime() - new Date(b.endDate).getTime()
      );
    else if (sort === "priority") {
      const p: Record<Priority, number> = { high: 0, medium: 1, low: 2 };
      list.sort((a, b) => (p[a.priority] ?? 1) - (p[b.priority] ?? 1));
    } else if (sort === "alpha") {
      list.sort((a, b) => a.task.localeCompare(b.task));
    }

    return list;
  }, [todos, filter, search, sort]);

  // ─── CRUD ────────────────────────────────────────────────────────────────────

  const resetForm = () => {
    setTaskText("");
    setNotesText("");
    setCategory("");
    setPriority("medium");
    setStartDate(todayStr());
    setEndDate("");
    setSelectedColor(COLORS[0].hex);
    setEditingId(null);
  };

  const openCreateModal = () => {
    resetForm();
    setModalVisible(true);
  };

  const openEditModal = (todo: Todo) => {
    setEditingId(todo.id);
    setTaskText(todo.task);
    setNotesText(todo.notes);
    setCategory(todo.category);
    setPriority(todo.priority);
    setStartDate(todo.startDate);
    setEndDate(todo.endDate);
    setSelectedColor(todo.color);
    setModalVisible(true);
  };

  const saveTask = async () => {
    if (!taskText.trim()) {
      Alert.alert("Missing Name", "Please enter a task name.");
      return;
    }
    if (!startDate) {
      Alert.alert("Missing Date", "Please select a start date.");
      return;
    }
    if (!endDate) {
      Alert.alert("Missing Date", "Please select an end date.");
      return;
    }
    if (endDate < startDate) {
      Alert.alert("Invalid Date", "End date must be after start date.");
      return;
    }

    if (editingId) {
      const updated = todos.map((t) =>
        t.id === editingId
          ? {
              ...t,
              task: taskText.trim(),
              notes: notesText.trim(),
              category,
              priority,
              startDate,
              endDate,
              color: selectedColor,
            }
          : t
      );
      setTodos(updated);
      await saveTodos(updated);
      showToast("Task updated", "info");
    } else {
      const newTodo: Todo = {
        id: genId(),
        task: taskText.trim(),
        notes: notesText.trim(),
        category,
        priority,
        startDate,
        endDate,
        color: selectedColor,
        done: false,
        createdAt: Date.now(),
        order: todos.length,
      };
      const updated = [newTodo, ...todos];
      setTodos(updated);
      await saveTodos(updated);
      showToast("Task created!", "success");
    }

    setModalVisible(false);
    resetForm();
  };

  const toggleDone = async (id: string) => {
    const updated = todos.map((t) =>
      t.id === id ? { ...t, done: !t.done } : t
    );
    setTodos(updated);
    await saveTodos(updated);
    const todo = updated.find((t) => t.id === id);
    showToast(todo?.done ? "Task completed!" : "Task reopened", "success");
  };

  const deleteTodo = (id: string) => {
    const todo = todos.find((t) => t.id === id);
    Alert.alert(
      "Delete Task",
      `"${todo?.task}" will be permanently removed.`,
      [
        { text: "Cancel", style: "cancel" },
        {
          text: "Delete",
          style: "destructive",
          onPress: async () => {
            const updated = todos.filter((t) => t.id !== id);
            setTodos(updated);
            await saveTodos(updated);
            showToast("Task deleted", "error");
          },
        },
      ]
    );
  };

  // ─── Selection & Bulk Actions ────────────────────────────────────────────────

  const toggleSelect = (id: string) => {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const bulkMarkDone = async () => {
    const updated = todos.map((t) =>
      selected.has(t.id) ? { ...t, done: true } : t
    );
    setTodos(updated);
    await saveTodos(updated);
    setSelected(new Set());
    showToast(`${selected.size} tasks completed`, "success");
  };

  const bulkDelete = () => {
    Alert.alert(
      `Delete ${selected.size} Tasks`,
      "This cannot be undone.",
      [
        { text: "Cancel", style: "cancel" },
        {
          text: "Delete All",
          style: "destructive",
          onPress: async () => {
            const updated = todos.filter((t) => !selected.has(t.id));
            setTodos(updated);
            await saveTodos(updated);
            setSelected(new Set());
            showToast("Tasks deleted", "error");
          },
        },
      ]
    );
  };

  const clearCompleted = async () => {
    Alert.alert("Clear Completed", "Remove all completed tasks?", [
      { text: "Cancel", style: "cancel" },
      {
        text: "Clear",
        style: "destructive",
        onPress: async () => {
          const updated = todos.filter((t) => !t.done);
          setTodos(updated);
          await saveTodos(updated);
          showToast("Cleared completed tasks", "info");
        },
      },
    ]);
  };

  // ─── Analytics helpers ───────────────────────────────────────────────────────

  const analyticsData = () => {
    const total = todos.length;
    const done = todos.filter((t) => t.done).length;
    const active = todos.filter((t) => !t.done).length;
    const overdue = todos.filter(
      (t) => !t.done && daysLeft(t.endDate) < 0
    ).length;
    const todayDue = todos.filter(
      (t) => !t.done && isToday(t.endDate)
    ).length;
    const completionRate = total > 0 ? Math.round((done / total) * 100) : 0;

    const byCategory = CATEGORIES.map((cat) => ({
      name: cat,
      total: todos.filter((t) => t.category === cat).length,
      done: todos.filter((t) => t.category === cat && t.done).length,
    })).filter((c) => c.total > 0);

    const byPriority = (["high", "medium", "low"] as Priority[]).map((p) => ({
      priority: p,
      count: todos.filter((t) => t.priority === p).length,
      done: todos.filter((t) => t.priority === p && t.done).length,
    }));

    return {
      total,
      done,
      active,
      overdue,
      todayDue,
      completionRate,
      byCategory,
      byPriority,
    };
  };

  // ─── Render Helpers ──────────────────────────────────────────────────────────

  const filterLabel = (): string => {
    if (filter === "all") return "All Tasks";
    if (filter === "active") return "Active";
    if (filter === "done") return "Completed";
    if (filter === "urgent") return "Urgent";
    if (filter === "today") return "Due Today";
    return filter;
  };

  const urgentCount = todos.filter(
    (t) => !t.done && daysLeft(t.endDate) <= 2
  ).length;
  const todayCount = todos.filter(
    (t) => !t.done && isToday(t.endDate)
  ).length;

  const usedCategories = CATEGORIES.filter((c) =>
    todos.some((t) => t.category === c)
  );

  // ─── Task List Item ──────────────────────────────────────────────────────────

  const renderTaskItem = ({ item: todo }: { item: Todo }) => {
    const st = statusInfo(todo);
    const isSelected = selected.has(todo.id);
    const pct = progressPct(todo);

    if (view === "grid") {
      return (
        <TouchableOpacity
          style={[
            styles.gridCard,
            isSelected && styles.cardSelected,
            { borderTopColor: todo.color, borderTopWidth: 3 },
          ]}
          onPress={() => openEditModal(todo)}
          onLongPress={() => toggleSelect(todo.id)}
          activeOpacity={0.8}
        >
          <View style={styles.gridCardHeader}>
            <TouchableOpacity
              style={[
                styles.selCheck,
                isSelected && {
                  backgroundColor: "#7c6af7",
                  borderColor: "#7c6af7",
                },
              ]}
              onPress={() => toggleSelect(todo.id)}
            >
              {isSelected && (
                <Text style={{ color: "white", fontSize: 10, fontWeight: "700" }}>
                  ✓
                </Text>
              )}
            </TouchableOpacity>
            {todo.category ? (
              <View style={styles.catTag}>
                <Text style={styles.catTagText}>{todo.category}</Text>
              </View>
            ) : null}
            <TouchableOpacity
              onPress={() => deleteTodo(todo.id)}
              style={styles.deleteBtn}
            >
              <Text style={styles.deleteBtnText}>✕</Text>
            </TouchableOpacity>
          </View>

          <TouchableOpacity
            style={[
              styles.checkCircle,
              todo.done && { backgroundColor: "#3ecf8e", borderColor: "#3ecf8e" },
            ]}
            onPress={() => toggleDone(todo.id)}
          >
            {todo.done && (
              <Text style={{ color: "#0d0d0f", fontSize: 11, fontWeight: "700" }}>
                ✓
              </Text>
            )}
          </TouchableOpacity>

          <Text
            style={[styles.gridTitle, todo.done && styles.doneText]}
            numberOfLines={2}
          >
            {todo.task}
          </Text>
          {todo.notes ? (
            <Text style={styles.notesPreview} numberOfLines={2}>
              {todo.notes}
            </Text>
          ) : null}

          <View>
            <View style={styles.gridDaysRow}>
              <Text
                style={[
                  styles.bigDays,
                  {
                    color: todo.done
                      ? "#3ecf8e"
                      : daysLeft(todo.endDate) < 0
                      ? "#f04444"
                      : daysLeft(todo.endDate) <= 5
                      ? "#f59e0b"
                      : "#3ecf8e",
                  },
                ]}
              >
                {todo.done
                  ? "✓"
                  : daysLeft(todo.endDate) < 0
                  ? `${Math.abs(daysLeft(todo.endDate))}d`
                  : `${daysLeft(todo.endDate)}d`}
              </Text>
              <View style={[styles.statusTag, { backgroundColor: st.color + "22" }]}>
                <Text style={[styles.statusTagText, { color: st.color }]}>
                  {st.label}
                </Text>
              </View>
            </View>
            <View style={styles.progressTrack}>
              <View
                style={[
                  styles.progressFill,
                  { width: `${pct}%` as any, backgroundColor: todo.color },
                ]}
              />
            </View>
          </View>

          <View style={styles.gridDateRow}>
            <Text style={styles.gridDate}>{todo.startDate}</Text>
            <Text style={styles.gridDate}>{todo.endDate}</Text>
          </View>
        </TouchableOpacity>
      );
    }

    // List view
    return (
      <TouchableOpacity
        style={[
          styles.taskCard,
          isSelected && styles.cardSelected,
          { borderLeftColor: todo.color, borderLeftWidth: 4 },
        ]}
        onPress={() => openEditModal(todo)}
        onLongPress={() => toggleSelect(todo.id)}
        activeOpacity={0.8}
      >
        <TouchableOpacity
          style={[
            styles.selCheck,
            isSelected && { backgroundColor: "#7c6af7", borderColor: "#7c6af7" },
          ]}
          onPress={() => toggleSelect(todo.id)}
        >
          {isSelected && (
            <Text style={{ color: "white", fontSize: 10, fontWeight: "700" }}>
              ✓
            </Text>
          )}
        </TouchableOpacity>

        <TouchableOpacity
          style={[
            styles.checkCircle,
            todo.done && { backgroundColor: "#3ecf8e", borderColor: "#3ecf8e" },
          ]}
          onPress={() => toggleDone(todo.id)}
        >
          {todo.done && (
            <Text style={{ color: "#0d0d0f", fontSize: 11, fontWeight: "700" }}>
              ✓
            </Text>
          )}
        </TouchableOpacity>

        <View
          style={[
            styles.priorityDot,
            { backgroundColor: PRIORITY_COLORS[todo.priority] },
          ]}
        />

        <View style={styles.taskBody}>
          <Text
            style={[styles.taskTitle, todo.done && styles.doneText]}
            numberOfLines={1}
          >
            {todo.task}
          </Text>
          <View style={styles.taskMeta}>
            {todo.category ? (
              <View style={styles.catTag}>
                <Text style={styles.catTagText}>{todo.category}</Text>
              </View>
            ) : null}
            <View style={[styles.statusTag, { backgroundColor: st.color + "22" }]}>
              <Text style={[styles.statusTagText, { color: st.color }]}>
                {st.label}
              </Text>
            </View>
            <Text style={styles.dateRange}>
              {todo.startDate} → {todo.endDate}
            </Text>
          </View>
          {todo.notes ? (
            <Text style={styles.notesPreview} numberOfLines={1}>
              {todo.notes}
            </Text>
          ) : null}
        </View>

        <TouchableOpacity
          onPress={() => deleteTodo(todo.id)}
          style={styles.deleteBtn}
        >
          <Text style={styles.deleteBtnText}>✕</Text>
        </TouchableOpacity>
      </TouchableOpacity>
    );
  };

  // ─── Analytics Screen ────────────────────────────────────────────────────────

  const renderAnalytics = () => {
    const data = analyticsData();
    const maxCat =
      data.byCategory.length > 0
        ? Math.max(...data.byCategory.map((c) => c.total))
        : 1;

    return (
      <ScrollView
        style={styles.analyticsScroll}
        showsVerticalScrollIndicator={false}
      >
        {/* Summary Cards */}
        <View style={styles.analyticsGrid}>
          {[
            {
              label: "Total",
              val: data.total,
              color: "#7c6af7",
              sub: `${data.active} active`,
            },
            {
              label: "Done",
              val: data.done,
              color: "#3ecf8e",
              sub: `${data.completionRate}% rate`,
            },
            {
              label: "Overdue",
              val: data.overdue,
              color: "#f04444",
              sub: "need attention",
            },
            {
              label: "Due Today",
              val: data.todayDue,
              color: "#3b82f6",
              sub: "today's focus",
            },
          ].map((item) => (
            <View key={item.label} style={styles.analyticsCard}>
              <Text style={styles.analyticsCardLabel}>{item.label}</Text>
              <Text style={[styles.analyticsCardVal, { color: item.color }]}>
                {item.val}
              </Text>
              <Text style={styles.analyticsCardSub}>{item.sub}</Text>
            </View>
          ))}
        </View>

        {/* Completion Rate Bar */}
        <View style={styles.chartCard}>
          <Text style={styles.chartTitle}>Completion Rate</Text>
          <View style={styles.completionRow}>
            <View style={styles.completionTrack}>
              <View
                style={[
                  styles.completionFill,
                  {
                    width: `${data.completionRate}%` as any,
                    backgroundColor: "#3ecf8e",
                  },
                ]}
              />
            </View>
            <Text style={[styles.completionPct, { color: "#3ecf8e" }]}>
              {data.completionRate}%
            </Text>
          </View>
          <Text style={styles.chartSub}>
            {data.done} of {data.total} tasks completed
          </Text>
        </View>

        {/* Priority Breakdown */}
        <View style={styles.chartCard}>
          <Text style={styles.chartTitle}>By Priority</Text>
          {data.byPriority.map((p) => (
            <AnalyticsBar
              key={p.priority}
              label={
                p.priority.charAt(0).toUpperCase() + p.priority.slice(1)
              }
              value={p.count}
              max={data.total || 1}
              color={PRIORITY_COLORS[p.priority]}
            />
          ))}
        </View>

        {/* Category Breakdown */}
        {data.byCategory.length > 0 && (
          <View style={styles.chartCard}>
            <Text style={styles.chartTitle}>By Category</Text>
            {data.byCategory.map((c) => (
              <AnalyticsBar
                key={c.name}
                label={c.name}
                value={c.total}
                max={maxCat}
                color="#7c6af7"
              />
            ))}
          </View>
        )}

        {/* Priority × Status breakdown */}
        <View style={styles.chartCard}>
          <Text style={styles.chartTitle}>Priority × Status</Text>
          {(["high", "medium", "low"] as Priority[]).map((p) => {
            const all = todos.filter((t) => t.priority === p);
            const d = all.filter((t) => t.done).length;
            const a = all.filter((t) => !t.done).length;
            if (all.length === 0) return null;
            return (
              <View key={p} style={styles.prioRow}>
                <View
                  style={[
                    styles.prioDot,
                    { backgroundColor: PRIORITY_COLORS[p] },
                  ]}
                />
                <Text style={styles.prioLabel}>
                  {p.charAt(0).toUpperCase() + p.slice(1)}
                </Text>
                <Text style={styles.prioStat}>
                  <Text style={{ color: "#3ecf8e" }}>{d} done</Text>
                  {"  "}
                  <Text style={{ color: "#f59e0b" }}>{a} active</Text>
                </Text>
              </View>
            );
          })}
        </View>

        <View style={{ height: 40 }} />
      </ScrollView>
    );
  };

  // ─── Sidebar ─────────────────────────────────────────────────────────────────

  const renderSidebar = () => (
    <Modal
      visible={sidebarOpen}
      transparent
      animationType="none"
      onRequestClose={closeSidebar}
    >
      <TouchableOpacity
        style={styles.sidebarOverlay}
        activeOpacity={1}
        onPress={closeSidebar}
      >
        <Animated.View
          style={[
            styles.sidebar,
            { transform: [{ translateX: sidebarAnim }] },
          ]}
        >
          <TouchableOpacity activeOpacity={1}>
            {/* Logo */}
            <View style={styles.sidebarLogo}>
              <LinearGradient
                colors={["#7c6af7", "#9b8fff"]}
                style={styles.logoBox}
              >
                <Text style={styles.logoIcon}>✦</Text>
              </LinearGradient>
              <Text style={styles.logoText}>
                Task<Text style={{ color: "#9b8fff" }}>Flow</Text>
              </Text>
            </View>

            {/* Mini Stats */}
            <View style={styles.miniStatsGrid}>
              {[
                { label: "Total", val: todos.length, color: "#9b8fff" },
                {
                  label: "Done",
                  val: todos.filter((t) => t.done).length,
                  color: "#3ecf8e",
                },
                {
                  label: "Active",
                  val: todos.filter((t) => !t.done).length,
                  color: "#f59e0b",
                },
                { label: "Urgent", val: urgentCount, color: "#f04444" },
              ].map((s) => (
                <View key={s.label} style={styles.miniStat}>
                  <Text style={styles.miniStatLabel}>{s.label}</Text>
                  <Text style={[styles.miniStatVal, { color: s.color }]}>
                    {s.val}
                  </Text>
                </View>
              ))}
            </View>

            {/* Tabs */}
            <Text style={styles.sidebarSectionLabel}>VIEWS</Text>
            {(
              [
                { id: "tasks", icon: "◫", label: "All Tasks" },
                { id: "analytics", icon: "◈", label: "Analytics" },
              ] as const
            ).map((item) => (
              <TouchableOpacity
                key={item.id}
                style={[
                  styles.navBtn,
                  tab === item.id && styles.navBtnActive,
                ]}
                onPress={() => {
                  setTab(item.id);
                  closeSidebar();
                }}
              >
                <Text
                  style={[
                    styles.navIcon,
                    tab === item.id && { color: "#9b8fff" },
                  ]}
                >
                  {item.icon}
                </Text>
                <Text
                  style={[
                    styles.navLabel,
                    tab === item.id && { color: "#9b8fff" },
                  ]}
                >
                  {item.label}
                </Text>
              </TouchableOpacity>
            ))}

            {/* Quick Filters */}
            <Text style={styles.sidebarSectionLabel}>FILTERS</Text>
            {[
              { id: "active", label: "Active", color: "#9b8fff", badge: todos.filter((t) => !t.done).length },
              { id: "today", label: "Due Today", color: "#3b82f6", badge: todayCount },
              { id: "urgent", label: "Urgent", color: "#f04444", badge: urgentCount },
              { id: "done", label: "Completed", color: "#3ecf8e", badge: todos.filter((t) => t.done).length },
              { id: "all", label: "All Tasks", color: "#7a7a8a", badge: todos.length },
            ].map((f) => (
              <TouchableOpacity
                key={f.id}
                style={[
                  styles.navBtn,
                  filter === f.id && tab === "tasks" && styles.navBtnActive,
                ]}
                onPress={() => {
                  setFilter(f.id as FilterType);
                  setTab("tasks");
                  closeSidebar();
                }}
              >
                <View
                  style={[styles.filterDot, { backgroundColor: f.color }]}
                />
                <Text
                  style={[
                    styles.navLabel,
                    filter === f.id &&
                      tab === "tasks" && { color: "#9b8fff" },
                  ]}
                >
                  {f.label}
                </Text>
                <View style={styles.navBadge}>
                  <Text style={styles.navBadgeText}>{f.badge}</Text>
                </View>
              </TouchableOpacity>
            ))}

            {/* Categories */}
            {usedCategories.length > 0 && (
              <>
                <Text style={styles.sidebarSectionLabel}>CATEGORIES</Text>
                {usedCategories.map((cat) => (
                  <TouchableOpacity
                    key={cat}
                    style={[
                      styles.navBtn,
                      filter === cat && tab === "tasks" && styles.navBtnActive,
                    ]}
                    onPress={() => {
                      setFilter(cat);
                      setTab("tasks");
                      closeSidebar();
                    }}
                  >
                    <Text style={styles.navIcon}>◆</Text>
                    <Text
                      style={[
                        styles.navLabel,
                        filter === cat &&
                          tab === "tasks" && { color: "#9b8fff" },
                      ]}
                    >
                      {cat}
                    </Text>
                    <View style={styles.navBadge}>
                      <Text style={styles.navBadgeText}>
                        {todos.filter((t) => t.category === cat).length}
                      </Text>
                    </View>
                  </TouchableOpacity>
                ))}
              </>
            )}

            {/* Clear Completed */}
            {todos.some((t) => t.done) && (
              <TouchableOpacity
                style={styles.clearBtn}
                onPress={() => {
                  closeSidebar();
                  setTimeout(clearCompleted, 300);
                }}
              >
                <Text style={styles.clearBtnText}>Clear Completed</Text>
              </TouchableOpacity>
            )}
          </TouchableOpacity>
        </Animated.View>
      </TouchableOpacity>
    </Modal>
  );

  // ─── Task Modal ──────────────────────────────────────────────────────────────

  const renderTaskModal = () => (
    <Modal
      visible={modalVisible}
      transparent
      animationType="slide"
      onRequestClose={() => setModalVisible(false)}
    >
      <View style={styles.modalOverlay}>
        <View style={styles.modal}>
          {/* Header */}
          <View style={styles.modalHeader}>
            <Text style={styles.modalTitle}>
              {editingId ? "Edit Task" : "New Task"}
            </Text>
            <TouchableOpacity
              style={styles.modalClose}
              onPress={() => setModalVisible(false)}
            >
              <Text style={styles.modalCloseText}>✕</Text>
            </TouchableOpacity>
          </View>

          {/* Date pickers MUST live outside ScrollView to work on iOS */}
          <DateTimePickerModal
            isVisible={showStartPicker}
            mode="date"
            date={startDate ? new Date(startDate + "T12:00:00") : new Date()}
            onConfirm={(date) => {
              const picked = date.toISOString().split("T")[0];
              setStartDate(picked);
              // If end date is now before start, clear it
              if (endDate && endDate < picked) setEndDate("");
              setShowStartPicker(false);
            }}
            onCancel={() => setShowStartPicker(false)}
          />
          <DateTimePickerModal
            isVisible={showEndPicker}
            mode="date"
            date={endDate ? new Date(endDate + "T12:00:00") : (startDate ? new Date(startDate + "T12:00:00") : new Date())}
            minimumDate={startDate ? new Date(startDate + "T12:00:00") : new Date()}
            onConfirm={(date) => {
              setEndDate(date.toISOString().split("T")[0]);
              setShowEndPicker(false);
            }}
            onCancel={() => setShowEndPicker(false)}
          />

          <ScrollView showsVerticalScrollIndicator={false}>
            {/* Task Name */}
            <Text style={styles.fieldLabel}>TASK NAME</Text>
            <TextInput
              style={styles.textInput}
              placeholder="What needs to be done?"
              placeholderTextColor="#45454f"
              value={taskText}
              onChangeText={setTaskText}
              maxLength={120}
            />

            {/* Notes */}
            <Text style={styles.fieldLabel}>NOTES</Text>
            <TextInput
              style={[styles.textInput, styles.textArea]}
              placeholder="Add details..."
              placeholderTextColor="#45454f"
              value={notesText}
              onChangeText={setNotesText}
              multiline
              numberOfLines={3}
              textAlignVertical="top"
            />

            {/* Category */}
            <Text style={styles.fieldLabel}>CATEGORY</Text>
            <ScrollView
              horizontal
              showsHorizontalScrollIndicator={false}
              style={styles.catScroll}
            >
              {["", ...CATEGORIES].map((cat) => (
                <TouchableOpacity
                  key={cat}
                  style={[
                    styles.catChip,
                    category === cat && styles.catChipActive,
                  ]}
                  onPress={() => setCategory(cat)}
                >
                  <Text
                    style={[
                      styles.catChipText,
                      category === cat && { color: "#9b8fff" },
                    ]}
                  >
                    {cat || "None"}
                  </Text>
                </TouchableOpacity>
              ))}
            </ScrollView>

            {/* Priority */}
            <Text style={styles.fieldLabel}>PRIORITY</Text>
            <View style={styles.prioButtons}>
              {(["low", "medium", "high"] as Priority[]).map((p) => (
                <TouchableOpacity
                  key={p}
                  style={[
                    styles.prioBtn,
                    priority === p && {
                      backgroundColor: PRIORITY_COLORS[p] + "22",
                      borderColor: PRIORITY_COLORS[p] + "55",
                    },
                  ]}
                  onPress={() => setPriority(p)}
                >
                  <Text
                    style={[
                      styles.prioBtnText,
                      priority === p && { color: PRIORITY_COLORS[p] },
                    ]}
                  >
                    {PRIORITY_LABELS[p]}
                  </Text>
                </TouchableOpacity>
              ))}
            </View>

            {/* Dates */}
            <Text style={styles.fieldLabel}>DATES</Text>
            <View style={styles.datesRow}>
              <TouchableOpacity
                style={[styles.dateBtn, { flex: 1, marginRight: 8 }]}
                onPress={() => {
                  setShowEndPicker(false);
                  setShowStartPicker(true);
                }}
              >
                <Text style={styles.dateBtnLabel}>📅 Start Date</Text>
                <Text style={[styles.dateBtnVal, !startDate && { color: "#55555f" }]}>
                  {startDate || "Tap to select"}
                </Text>
              </TouchableOpacity>
              <TouchableOpacity
                style={[
                  styles.dateBtn,
                  { flex: 1 },
                  !endDate && { borderColor: "rgba(240,68,68,0.3)", borderWidth: 1 },
                ]}
                onPress={() => {
                  setShowStartPicker(false);
                  setShowEndPicker(true);
                }}
              >
                <Text style={styles.dateBtnLabel}>⏰ End Date</Text>
                <Text style={[styles.dateBtnVal, !endDate && { color: "#f04444" }]}>
                  {endDate || "Tap to select"}
                </Text>
              </TouchableOpacity>
            </View>
            {!endDate && (
              <Text style={{ fontSize: 11, color: "#f04444", marginTop: 4 }}>
                End date is required
              </Text>
            )}

            {/* Color Picker */}
            <Text style={styles.fieldLabel}>COLOR</Text>
            <View style={styles.colorGrid}>
              {COLORS.map((c) => (
                <TouchableOpacity
                  key={c.hex}
                  style={[
                    styles.colorSwatch,
                    { backgroundColor: c.hex },
                    selectedColor === c.hex && styles.colorSwatchSelected,
                  ]}
                  onPress={() => setSelectedColor(c.hex)}
                >
                  {selectedColor === c.hex && (
                    <Text style={styles.swatchCheck}>✓</Text>
                  )}
                </TouchableOpacity>
              ))}
            </View>

            {/* Footer */}
            <View style={styles.modalFooter}>
              <TouchableOpacity
                style={styles.btnCancel}
                onPress={() => setModalVisible(false)}
              >
                <Text style={styles.btnCancelText}>Cancel</Text>
              </TouchableOpacity>
              <TouchableOpacity style={styles.btnSave} onPress={saveTask}>
                <LinearGradient
                  colors={["#7c6af7", "#9b8fff"]}
                  start={{ x: 0, y: 0 }}
                  end={{ x: 1, y: 0 }}
                  style={styles.btnSaveGradient}
                >
                  <Text style={styles.btnSaveText}>
                    {editingId ? "Update Task" : "Create Task"}
                  </Text>
                </LinearGradient>
              </TouchableOpacity>
            </View>
          </ScrollView>
        </View>
      </View>
    </Modal>
  );

  // ─── Main Render ─────────────────────────────────────────────────────────────

  const list = filteredTodos();
  const doneForToday = todos.filter(
    (t) => !t.done && isToday(t.endDate)
  );

  return (
    <LinearGradient colors={["#0d0d0f", "#141417"]} style={styles.root}>
      <StatusBar barStyle="light-content" backgroundColor="#0d0d0f" />

      {/* Header */}
      <View style={styles.header}>
        <TouchableOpacity style={styles.menuBtn} onPress={openSidebar}>
          <Text style={styles.menuBtnText}>☰</Text>
        </TouchableOpacity>
        <View style={styles.headerCenter}>
          <Text style={styles.headerTitle}>
            {tab === "analytics" ? "Analytics" : filterLabel()}
          </Text>
          {tab === "tasks" && (
            <Text style={styles.headerSub}>
              {list.length} task{list.length !== 1 ? "s" : ""}
            </Text>
          )}
        </View>
        {tab === "tasks" ? (
          <View style={styles.headerRight}>
            <TouchableOpacity
              style={styles.viewToggleBtn}
              onPress={() => setView(view === "list" ? "grid" : "list")}
            >
              <Text style={styles.viewToggleText}>
                {view === "list" ? "⊞" : "☰"}
              </Text>
            </TouchableOpacity>
            <TouchableOpacity
              style={styles.newBtn}
              onPress={openCreateModal}
            >
              <LinearGradient
                colors={["#7c6af7", "#9b8fff"]}
                style={styles.newBtnGradient}
              >
                <Text style={styles.newBtnText}>＋</Text>
              </LinearGradient>
            </TouchableOpacity>
          </View>
        ) : (
          <View style={{ width: 80 }} />
        )}
      </View>

      {/* Search Bar (tasks only) */}
      {tab === "tasks" && (
        <View style={styles.searchBar}>
          <Text style={styles.searchIcon}>⌕</Text>
          <TextInput
            style={styles.searchInput}
            placeholder="Search tasks..."
            placeholderTextColor="#45454f"
            value={search}
            onChangeText={setSearch}
          />
          {search.length > 0 && (
            <TouchableOpacity onPress={() => setSearch("")}>
              <Text style={styles.searchClear}>✕</Text>
            </TouchableOpacity>
          )}
        </View>
      )}

      {/* Sort Bar (tasks only) */}
      {tab === "tasks" && (
        <ScrollView
          horizontal
          showsHorizontalScrollIndicator={false}
          style={styles.sortBar}
          contentContainerStyle={styles.sortBarContent}
        >
          {(
            [
              { id: "created", label: "Newest" },
              { id: "deadline", label: "Deadline" },
              { id: "priority", label: "Priority" },
              { id: "alpha", label: "A–Z" },
            ] as const
          ).map((s) => (
            <TouchableOpacity
              key={s.id}
              style={[styles.sortChip, sort === s.id && styles.sortChipActive]}
              onPress={() => setSort(s.id)}
            >
              <Text
                style={[
                  styles.sortChipText,
                  sort === s.id && { color: "#9b8fff" },
                ]}
              >
                {s.label}
              </Text>
            </TouchableOpacity>
          ))}
        </ScrollView>
      )}

      {/* Bulk Action Bar */}
      {selected.size > 0 && tab === "tasks" && (
        <View style={styles.bulkBar}>
          <Text style={styles.bulkInfo}>
            {selected.size} selected
          </Text>
          <TouchableOpacity style={styles.bulkBtn} onPress={bulkMarkDone}>
            <Text style={styles.bulkBtnText}>✓ Done</Text>
          </TouchableOpacity>
          <TouchableOpacity
            style={styles.bulkBtn}
            onPress={() => setSelected(new Set())}
          >
            <Text style={styles.bulkBtnText}>✕ Clear</Text>
          </TouchableOpacity>
          <TouchableOpacity
            style={[styles.bulkBtn, styles.bulkBtnDel]}
            onPress={bulkDelete}
          >
            <Text style={[styles.bulkBtnText, { color: "#f04444" }]}>
              🗑 Delete
            </Text>
          </TouchableOpacity>
        </View>
      )}

      {/* Due Today Banner */}
      {tab === "tasks" &&
        filter === "all" &&
        doneForToday.length > 0 && (
          <View style={styles.dueBanner}>
            <View style={styles.dueBannerIcon}>
              <Text style={{ fontSize: 16 }}>◷</Text>
            </View>
            <View style={{ flex: 1 }}>
              <Text style={styles.dueBannerTitle}>
                {doneForToday.length} task
                {doneForToday.length > 1 ? "s" : ""} due today
              </Text>
              <Text style={styles.dueBannerSub} numberOfLines={1}>
                {doneForToday
                  .slice(0, 3)
                  .map((t) => t.task)
                  .join(", ")}
                {doneForToday.length > 3 ? "…" : ""}
              </Text>
            </View>
          </View>
        )}

      {/* Content */}
      {tab === "analytics" ? (
        renderAnalytics()
      ) : (
        <FlatList
          data={list}
          keyExtractor={(item) => item.id}
          renderItem={renderTaskItem}
          showsVerticalScrollIndicator={false}
          contentContainerStyle={[
            styles.listContent,
            view === "grid" && styles.gridContent,
          ]}
          numColumns={view === "grid" ? 2 : 1}
          key={view} // force re-mount on view change
          ListEmptyComponent={
            <View style={styles.emptyState}>
              <View style={styles.emptyIcon}>
                <Text style={{ fontSize: 28 }}>◎</Text>
              </View>
              <Text style={styles.emptyTitle}>
                {search ? "No results" : "No tasks here"}
              </Text>
              <Text style={styles.emptySub}>
                {search
                  ? "Try a different search"
                  : "Tap ＋ to add your first task"}
              </Text>
            </View>
          }
        />
      )}

      {/* FAB */}
      {tab === "tasks" && (
        <TouchableOpacity
          style={styles.fab}
          onPress={openCreateModal}
          activeOpacity={0.85}
        >
          <LinearGradient
            colors={["#7c6af7", "#9b8fff"]}
            style={styles.fabGradient}
          >
            <Text style={styles.fabText}>＋</Text>
          </LinearGradient>
        </TouchableOpacity>
      )}

      {/* Modals */}
      {renderSidebar()}
      {renderTaskModal()}

      {/* Toasts */}
      <View style={styles.toastContainer} pointerEvents="none">
        {toasts.map((t) => (
          <Toast
            key={t.id}
            message={t.message}
            type={t.type}
            onHide={() => removeToast(t.id)}
          />
        ))}
      </View>
    </LinearGradient>
  );
}

// ─── Styles ───────────────────────────────────────────────────────────────────

const styles = StyleSheet.create({
  root: { flex: 1 },

  // Header
  header: {
    flexDirection: "row",
    alignItems: "center",
    paddingTop: Platform.OS === "ios" ? 56 : 40,
    paddingBottom: 14,
    paddingHorizontal: 16,
    gap: 12,
  },
  menuBtn: {
    width: 38,
    height: 38,
    borderRadius: 10,
    backgroundColor: "#1a1a1f",
    borderWidth: 1,
    borderColor: "rgba(255,255,255,0.07)",
    alignItems: "center",
    justifyContent: "center",
  },
  menuBtnText: { color: "#7a7a8a", fontSize: 16 },
  headerCenter: { flex: 1 },
  headerTitle: {
    fontFamily: Platform.OS === "ios" ? "System" : "sans-serif-condensed",
    fontSize: 20,
    fontWeight: "800",
    color: "#f0f0f5",
    letterSpacing: -0.5,
  },
  headerSub: { fontSize: 12, color: "#7a7a8a", marginTop: 1 },
  headerRight: { flexDirection: "row", alignItems: "center", gap: 8 },
  viewToggleBtn: {
    width: 36,
    height: 36,
    borderRadius: 9,
    backgroundColor: "#1a1a1f",
    borderWidth: 1,
    borderColor: "rgba(255,255,255,0.07)",
    alignItems: "center",
    justifyContent: "center",
  },
  viewToggleText: { color: "#7a7a8a", fontSize: 16 },
  newBtn: { borderRadius: 20, overflow: "hidden" },
  newBtnGradient: {
    width: 36,
    height: 36,
    alignItems: "center",
    justifyContent: "center",
    borderRadius: 18,
  },
  newBtnText: { color: "white", fontSize: 20, fontWeight: "700", lineHeight: 24 },

  // Search
  searchBar: {
    flexDirection: "row",
    alignItems: "center",
    backgroundColor: "#1a1a1f",
    borderRadius: 12,
    marginHorizontal: 16,
    marginBottom: 10,
    paddingHorizontal: 12,
    borderWidth: 1,
    borderColor: "rgba(255,255,255,0.07)",
  },
  searchIcon: { color: "#7a7a8a", fontSize: 16, marginRight: 8 },
  searchInput: { flex: 1, color: "#f0f0f5", fontSize: 14, paddingVertical: 10 },
  searchClear: { color: "#55555f", fontSize: 13, padding: 4 },

  // Sort
  sortBar: { maxHeight: 44, marginBottom: 4 },
  sortBarContent: { paddingHorizontal: 16, gap: 8, alignItems: "center" },
  sortChip: {
    paddingHorizontal: 14,
    paddingVertical: 6,
    borderRadius: 20,
    backgroundColor: "#1a1a1f",
    borderWidth: 1,
    borderColor: "rgba(255,255,255,0.07)",
  },
  sortChipActive: {
    backgroundColor: "rgba(124,106,247,0.15)",
    borderColor: "rgba(124,106,247,0.3)",
  },
  sortChipText: { fontSize: 12, color: "#7a7a8a", fontWeight: "500" },

  // Bulk
  bulkBar: {
    flexDirection: "row",
    alignItems: "center",
    backgroundColor: "rgba(124,106,247,0.1)",
    borderTopWidth: 1,
    borderBottomWidth: 1,
    borderColor: "rgba(124,106,247,0.2)",
    paddingHorizontal: 16,
    paddingVertical: 8,
    gap: 8,
  },
  bulkInfo: { flex: 1, fontSize: 13, color: "#9b8fff" },
  bulkBtn: {
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderRadius: 7,
    backgroundColor: "#1a1a1f",
    borderWidth: 1,
    borderColor: "rgba(255,255,255,0.08)",
  },
  bulkBtnDel: {
    borderColor: "rgba(240,68,68,0.25)",
    backgroundColor: "rgba(240,68,68,0.08)",
  },
  bulkBtnText: { fontSize: 12, color: "#7a7a8a", fontWeight: "500" },

  // Due Today Banner
  dueBanner: {
    flexDirection: "row",
    alignItems: "center",
    gap: 12,
    marginHorizontal: 16,
    marginBottom: 10,
    backgroundColor: "rgba(59,130,246,0.1)",
    borderRadius: 14,
    borderWidth: 1,
    borderColor: "rgba(59,130,246,0.2)",
    padding: 12,
  },
  dueBannerIcon: {
    width: 32,
    height: 32,
    borderRadius: 8,
    backgroundColor: "rgba(59,130,246,0.15)",
    alignItems: "center",
    justifyContent: "center",
  },
  dueBannerTitle: { fontSize: 13, color: "#f0f0f5", fontWeight: "600" },
  dueBannerSub: { fontSize: 11, color: "#7a7a8a", marginTop: 2 },

  // List
  listContent: { paddingHorizontal: 16, paddingBottom: 100, paddingTop: 8 },
  gridContent: { paddingHorizontal: 12, gap: 10 },

  // Task Card (list)
  taskCard: {
    flexDirection: "row",
    alignItems: "flex-start",
    backgroundColor: "#141417",
    borderRadius: 16,
    marginBottom: 8,
    padding: 14,
    gap: 10,
    borderWidth: 1,
    borderColor: "rgba(255,255,255,0.07)",
  },
  cardSelected: {
    backgroundColor: "rgba(124,106,247,0.06)",
    borderColor: "rgba(124,106,247,0.25)",
  },
  selCheck: {
    width: 18,
    height: 18,
    borderRadius: 5,
    borderWidth: 1.5,
    borderColor: "rgba(255,255,255,0.2)",
    alignItems: "center",
    justifyContent: "center",
    marginTop: 2,
  },
  checkCircle: {
    width: 20,
    height: 20,
    borderRadius: 6,
    borderWidth: 1.5,
    borderColor: "rgba(255,255,255,0.2)",
    alignItems: "center",
    justifyContent: "center",
    marginTop: 1,
  },
  priorityDot: {
    width: 6,
    height: 6,
    borderRadius: 3,
    marginTop: 7,
  },
  taskBody: { flex: 1, minWidth: 0 },
  taskTitle: {
    fontSize: 14,
    fontWeight: "500",
    color: "#f0f0f5",
    marginBottom: 5,
  },
  doneText: { color: "#55555f", textDecorationLine: "line-through" },
  taskMeta: { flexDirection: "row", flexWrap: "wrap", gap: 6, alignItems: "center" },
  catTag: {
    paddingHorizontal: 8,
    paddingVertical: 2,
    borderRadius: 20,
    backgroundColor: "rgba(124,106,247,0.15)",
    borderWidth: 1,
    borderColor: "rgba(124,106,247,0.25)",
  },
  catTagText: { fontSize: 10, color: "#9b8fff", fontWeight: "600" },
  statusTag: {
    paddingHorizontal: 8,
    paddingVertical: 2,
    borderRadius: 20,
  },
  statusTagText: { fontSize: 10, fontWeight: "600" },
  dateRange: { fontSize: 11, color: "#7a7a8a" },
  notesPreview: { fontSize: 11, color: "#55555f", marginTop: 4 },
  deleteBtn: {
    width: 26,
    height: 26,
    borderRadius: 6,
    backgroundColor: "#1a1a1f",
    borderWidth: 1,
    borderColor: "rgba(255,255,255,0.07)",
    alignItems: "center",
    justifyContent: "center",
  },
  deleteBtnText: { color: "#55555f", fontSize: 11 },

  // Grid Card
  gridCard: {
    flex: 1,
    backgroundColor: "#141417",
    borderRadius: 16,
    padding: 14,
    margin: 4,
    gap: 10,
    borderWidth: 1,
    borderColor: "rgba(255,255,255,0.07)",
    minWidth: (SCREEN_WIDTH - 56) / 2,
    maxWidth: (SCREEN_WIDTH - 56) / 2,
  },
  gridCardHeader: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
  },
  gridTitle: {
    fontSize: 14,
    fontWeight: "600",
    color: "#f0f0f5",
    lineHeight: 20,
  },
  gridDaysRow: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "flex-end",
    marginBottom: 6,
  },
  bigDays: {
    fontSize: 24,
    fontWeight: "800",
    letterSpacing: -0.5,
  },
  progressTrack: {
    height: 4,
    backgroundColor: "#222228",
    borderRadius: 2,
    overflow: "hidden",
  },
  progressFill: { height: 4, borderRadius: 2 },
  gridDateRow: {
    flexDirection: "row",
    justifyContent: "space-between",
  },
  gridDate: { fontSize: 10, color: "#55555f" },

  // FAB
  fab: {
    position: "absolute",
    bottom: 32,
    right: 20,
    borderRadius: 28,
    overflow: "hidden",
    elevation: 8,
    shadowColor: "#7c6af7",
    shadowOpacity: 0.4,
    shadowOffset: { width: 0, height: 4 },
    shadowRadius: 12,
  },
  fabGradient: {
    width: 56,
    height: 56,
    alignItems: "center",
    justifyContent: "center",
    borderRadius: 28,
  },
  fabText: { color: "white", fontSize: 24, fontWeight: "700", lineHeight: 30 },

  // Empty
  emptyState: {
    alignItems: "center",
    paddingVertical: 60,
    gap: 10,
  },
  emptyIcon: {
    width: 60,
    height: 60,
    borderRadius: 18,
    backgroundColor: "#1a1a1f",
    borderWidth: 1,
    borderColor: "rgba(255,255,255,0.07)",
    alignItems: "center",
    justifyContent: "center",
    marginBottom: 8,
  },
  emptyTitle: {
    fontSize: 17,
    fontWeight: "700",
    color: "#f0f0f5",
  },
  emptySub: { fontSize: 13, color: "#7a7a8a" },

  // Sidebar
  sidebarOverlay: {
    flex: 1,
    backgroundColor: "rgba(0,0,0,0.6)",
    flexDirection: "row",
  },
  sidebar: {
    width: 280,
    backgroundColor: "#141417",
    borderRightWidth: 1,
    borderRightColor: "rgba(255,255,255,0.07)",
    paddingTop: Platform.OS === "ios" ? 56 : 40,
    paddingHorizontal: 16,
    paddingBottom: 40,
  },
  sidebarLogo: {
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
    marginBottom: 20,
  },
  logoBox: {
    width: 34,
    height: 34,
    borderRadius: 9,
    alignItems: "center",
    justifyContent: "center",
  },
  logoIcon: { color: "white", fontSize: 16 },
  logoText: {
    fontSize: 19,
    fontWeight: "800",
    color: "#f0f0f5",
    letterSpacing: -0.3,
  },
  miniStatsGrid: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: 8,
    marginBottom: 20,
  },
  miniStat: {
    flex: 1,
    minWidth: "44%",
    backgroundColor: "#1a1a1f",
    borderRadius: 10,
    borderWidth: 1,
    borderColor: "rgba(255,255,255,0.07)",
    padding: 10,
  },
  miniStatLabel: {
    fontSize: 10,
    color: "#55555f",
    textTransform: "uppercase",
    letterSpacing: 0.06,
    fontWeight: "600",
    marginBottom: 4,
  },
  miniStatVal: { fontSize: 20, fontWeight: "800" },
  sidebarSectionLabel: {
    fontSize: 10,
    color: "#45454f",
    fontWeight: "700",
    letterSpacing: 0.1,
    marginBottom: 6,
    marginTop: 16,
    paddingHorizontal: 4,
  },
  navBtn: {
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
    paddingVertical: 9,
    paddingHorizontal: 10,
    borderRadius: 8,
    marginBottom: 2,
  },
  navBtnActive: {
    backgroundColor: "rgba(124,106,247,0.15)",
    borderWidth: 1,
    borderColor: "rgba(124,106,247,0.2)",
  },
  navIcon: { fontSize: 14, color: "#7a7a8a", width: 16 },
  navLabel: { flex: 1, fontSize: 13, color: "#7a7a8a" },
  navBadge: {
    backgroundColor: "#222228",
    borderRadius: 20,
    paddingHorizontal: 7,
    paddingVertical: 1,
  },
  navBadgeText: { fontSize: 10, color: "#7a7a8a" },
  filterDot: { width: 8, height: 8, borderRadius: 4 },
  clearBtn: {
    marginTop: 20,
    padding: 12,
    borderRadius: 10,
    borderWidth: 1,
    borderColor: "rgba(240,68,68,0.2)",
    backgroundColor: "rgba(240,68,68,0.06)",
    alignItems: "center",
  },
  clearBtnText: { fontSize: 13, color: "#f04444", fontWeight: "600" },

  // Modal
  modalOverlay: {
    flex: 1,
    backgroundColor: "rgba(0,0,0,0.75)",
    justifyContent: "flex-end",
  },
  modal: {
    backgroundColor: "#141417",
    borderTopLeftRadius: 24,
    borderTopRightRadius: 24,
    borderTopWidth: 1,
    borderColor: "rgba(255,255,255,0.1)",
    padding: 24,
    maxHeight: "90%",
  },
  modalHeader: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    marginBottom: 20,
  },
  modalTitle: {
    fontSize: 20,
    fontWeight: "800",
    color: "#f0f0f5",
    letterSpacing: -0.3,
  },
  modalClose: {
    width: 30,
    height: 30,
    borderRadius: 8,
    backgroundColor: "#1a1a1f",
    borderWidth: 1,
    borderColor: "rgba(255,255,255,0.08)",
    alignItems: "center",
    justifyContent: "center",
  },
  modalCloseText: { color: "#7a7a8a", fontSize: 13 },
  fieldLabel: {
    fontSize: 11,
    fontWeight: "700",
    color: "#55555f",
    letterSpacing: 0.07,
    marginBottom: 8,
    marginTop: 16,
  },
  textInput: {
    backgroundColor: "#1a1a1f",
    borderRadius: 12,
    borderWidth: 1,
    borderColor: "rgba(255,255,255,0.07)",
    paddingHorizontal: 14,
    paddingVertical: 12,
    color: "#f0f0f5",
    fontSize: 14,
  },
  textArea: { minHeight: 72, textAlignVertical: "top" },
  catScroll: { marginBottom: 4 },
  catChip: {
    paddingHorizontal: 14,
    paddingVertical: 7,
    borderRadius: 20,
    backgroundColor: "#1a1a1f",
    borderWidth: 1,
    borderColor: "rgba(255,255,255,0.07)",
    marginRight: 8,
  },
  catChipActive: {
    backgroundColor: "rgba(124,106,247,0.15)",
    borderColor: "rgba(124,106,247,0.3)",
  },
  catChipText: { fontSize: 12, color: "#7a7a8a", fontWeight: "500" },
  prioButtons: { flexDirection: "row", gap: 8 },
  prioBtn: {
    flex: 1,
    paddingVertical: 10,
    borderRadius: 10,
    borderWidth: 1,
    borderColor: "rgba(255,255,255,0.08)",
    backgroundColor: "#1a1a1f",
    alignItems: "center",
  },
  prioBtnText: { fontSize: 12, fontWeight: "600", color: "#7a7a8a" },
  datesRow: { flexDirection: "row", gap: 8 },
  dateBtn: {
    backgroundColor: "#1a1a1f",
    borderRadius: 12,
    borderWidth: 1,
    borderColor: "rgba(255,255,255,0.07)",
    padding: 12,
  },
  dateBtnLabel: { fontSize: 11, color: "#7a7a8a", fontWeight: "600", marginBottom: 6 },
  dateBtnVal: { fontSize: 13, color: "#f0f0f5", fontWeight: "500" },
  colorGrid: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: 10,
    marginBottom: 4,
  },
  colorSwatch: {
    width: 38,
    height: 38,
    borderRadius: 10,
    alignItems: "center",
    justifyContent: "center",
    borderWidth: 2,
    borderColor: "transparent",
  },
  colorSwatchSelected: { borderColor: "white", transform: [{ scale: 1.12 }] },
  swatchCheck: { color: "white", fontSize: 14, fontWeight: "700" },
  modalFooter: {
    flexDirection: "row",
    gap: 10,
    marginTop: 24,
    marginBottom: 8,
  },
  btnCancel: {
    flex: 1,
    padding: 14,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: "rgba(255,255,255,0.08)",
    backgroundColor: "#1a1a1f",
    alignItems: "center",
  },
  btnCancelText: { color: "#7a7a8a", fontSize: 14, fontWeight: "500" },
  btnSave: { flex: 2, borderRadius: 12, overflow: "hidden" },
  btnSaveGradient: { padding: 14, alignItems: "center" },
  btnSaveText: { color: "white", fontSize: 14, fontWeight: "700" },

  // Analytics
  analyticsScroll: { flex: 1 },
  analyticsGrid: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: 10,
    padding: 16,
  },
  analyticsCard: {
    minWidth: "44%",
    flex: 1,
    backgroundColor: "#141417",
    borderRadius: 16,
    borderWidth: 1,
    borderColor: "rgba(255,255,255,0.07)",
    padding: 16,
  },
  analyticsCardLabel: {
    fontSize: 11,
    color: "#55555f",
    textTransform: "uppercase",
    fontWeight: "600",
    letterSpacing: 0.07,
    marginBottom: 6,
  },
  analyticsCardVal: { fontSize: 28, fontWeight: "800", marginBottom: 3 },
  analyticsCardSub: { fontSize: 11, color: "#7a7a8a" },
  chartCard: {
    backgroundColor: "#141417",
    borderRadius: 16,
    borderWidth: 1,
    borderColor: "rgba(255,255,255,0.07)",
    padding: 16,
    marginHorizontal: 16,
    marginBottom: 12,
  },
  chartTitle: {
    fontSize: 13,
    fontWeight: "600",
    color: "#f0f0f5",
    marginBottom: 14,
  },
  completionRow: { flexDirection: "row", alignItems: "center", gap: 10, marginBottom: 6 },
  completionTrack: {
    flex: 1,
    height: 10,
    backgroundColor: "#222228",
    borderRadius: 5,
    overflow: "hidden",
  },
  completionFill: { height: 10, borderRadius: 5 },
  completionPct: { fontSize: 16, fontWeight: "700", width: 44 },
  chartSub: { fontSize: 12, color: "#7a7a8a" },
  barRow: { flexDirection: "row", alignItems: "center", gap: 10, marginBottom: 8 },
  barLabel: { fontSize: 12, color: "#7a7a8a", width: 70, textAlign: "right" },
  barTrack: {
    flex: 1,
    height: 8,
    backgroundColor: "#222228",
    borderRadius: 4,
    overflow: "hidden",
  },
  barFill: { height: 8, borderRadius: 4 },
  barVal: { fontSize: 12, color: "#7a7a8a", width: 24, textAlign: "right" },
  prioRow: { flexDirection: "row", alignItems: "center", gap: 10, marginBottom: 10 },
  prioDot: { width: 8, height: 8, borderRadius: 4 },
  prioLabel: { fontSize: 13, color: "#f0f0f5", width: 60 },
  prioStat: { fontSize: 12, color: "#7a7a8a" },

  // Toast
  toastContainer: {
    position: "absolute",
    bottom: 100,
    left: 16,
    right: 16,
    gap: 8,
  },
  toast: {
    flexDirection: "row",
    alignItems: "center",
    backgroundColor: "#1a1a1f",
    borderRadius: 12,
    borderWidth: 1,
    borderColor: "rgba(255,255,255,0.08)",
    borderLeftWidth: 3,
    padding: 12,
    gap: 10,
  },
  toastIcon: {
    width: 26,
    height: 26,
    borderRadius: 6,
    alignItems: "center",
    justifyContent: "center",
  },
  toastIconText: { fontSize: 12, fontWeight: "700" },
  toastText: { flex: 1, fontSize: 13, color: "#f0f0f5" },
});