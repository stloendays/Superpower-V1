#include "agent_core.h"

#include <QDesktopServices>
#include <QFileInfo>
#include <QJsonArray>
#include <QJsonValue>
#include <QUrl>

namespace {

QJsonObject requestArgs(const QJsonObject& request) {
  return request.value(QStringLiteral("args")).toObject();
}

QString requiredString(const QJsonObject& args, const QString& key) {
  return args.value(key).toString().trimmed();
}

}  // namespace

AgentCore::AgentCore(QString databasePath)
    : memoryStore_(std::move(databasePath)), fileLocator_(memoryStore_) {}

bool AgentCore::initialize(QString* error) {
  return memoryStore_.open(error);
}

MemoryStore& AgentCore::memoryStore() {
  return memoryStore_;
}

QJsonObject AgentCore::success(const QJsonObject& request, const QJsonValue& result) {
  QJsonObject response{{QStringLiteral("ok"), true}, {QStringLiteral("result"), result}};
  if (request.contains(QStringLiteral("id"))) response.insert(QStringLiteral("id"), request.value(QStringLiteral("id")));
  return response;
}

QJsonObject AgentCore::failure(const QJsonObject& request, const QString& code, const QString& message,
                               bool confirmationRequired) {
  QJsonObject error{{QStringLiteral("code"), code}, {QStringLiteral("message"), message}};
  if (confirmationRequired) error.insert(QStringLiteral("confirmation_required"), true);
  QJsonObject response{{QStringLiteral("ok"), false}, {QStringLiteral("error"), error}};
  if (request.contains(QStringLiteral("id"))) response.insert(QStringLiteral("id"), request.value(QStringLiteral("id")));
  return response;
}

QJsonObject AgentCore::locationToJson(const LocationMemory& memory) {
  QJsonObject object{{QStringLiteral("id"), memory.id},
                     {QStringLiteral("alias"), memory.alias},
                     {QStringLiteral("path"), memory.path},
                     {QStringLiteral("kind"), memory.kind},
                     {QStringLiteral("note"), memory.note},
                     {QStringLiteral("use_count"), memory.useCount}};
  if (memory.lastUsedAt.isValid()) {
    object.insert(QStringLiteral("last_used_at"), memory.lastUsedAt.toUTC().toString(Qt::ISODate));
  }
  return object;
}

QJsonObject AgentCore::locatedPathToJson(const LocatedPath& located) {
  QJsonObject object{{QStringLiteral("path"), located.path},
                     {QStringLiteral("name"), located.displayName},
                     {QStringLiteral("source"), located.source},
                     {QStringLiteral("kind"), located.isDirectory ? QStringLiteral("directory") : QStringLiteral("file")}};
  if (!located.alias.isEmpty()) object.insert(QStringLiteral("alias"), located.alias);
  return object;
}

QJsonObject AgentCore::rootToJson(const SearchRoot& root) {
  return QJsonObject{{QStringLiteral("id"), root.id},
                     {QStringLiteral("label"), root.label},
                     {QStringLiteral("path"), root.path},
                     {QStringLiteral("recursive"), root.recursive}};
}

QJsonObject AgentCore::handle(const QJsonObject& request) {
  const QString action = request.value(QStringLiteral("action")).toString().trimmed();
  if (action.isEmpty()) return failure(request, QStringLiteral("invalid_request"), QStringLiteral("Missing action."));

  if (action == QStringLiteral("ping")) {
    return success(request, QJsonObject{{QStringLiteral("service"), QStringLiteral("superpower-local-agent")},
                                        {QStringLiteral("version"), QStringLiteral("0.1.0")}});
  }
  if (action == QStringLiteral("capabilities")) return handleCapabilities(request);
  if (action == QStringLiteral("memory.remember")) return handleRemember(request);
  if (action == QStringLiteral("memory.forget")) return handleForget(request);
  if (action == QStringLiteral("memory.resolve")) return handleResolve(request);
  if (action == QStringLiteral("memory.list")) return handleList(request);
  if (action == QStringLiteral("memory.add_root")) return handleAddRoot(request);
  if (action == QStringLiteral("memory.list_roots")) return handleListRoots(request);
  if (action == QStringLiteral("file.search")) return handleSearch(request);
  if (action == QStringLiteral("file.open")) return handleOpen(request);

  return failure(request, QStringLiteral("unknown_action"), QStringLiteral("Unknown local-agent action: %1").arg(action));
}

QJsonObject AgentCore::handleCapabilities(const QJsonObject& request) const {
  const QJsonArray actions{QStringLiteral("ping"),
                           QStringLiteral("capabilities"),
                           QStringLiteral("memory.remember"),
                           QStringLiteral("memory.forget"),
                           QStringLiteral("memory.resolve"),
                           QStringLiteral("memory.list"),
                           QStringLiteral("memory.add_root"),
                           QStringLiteral("memory.list_roots"),
                           QStringLiteral("file.search"),
                           QStringLiteral("file.open")};
  return success(request, QJsonObject{{QStringLiteral("actions"), actions},
                                      {QStringLiteral("filesystem_write"), false},
                                      {QStringLiteral("file_open_requires_approval"), true},
                                      {QStringLiteral("search_scope"), QStringLiteral("remembered locations + approved roots")}});
}

QJsonObject AgentCore::handleRemember(const QJsonObject& request) {
  const QJsonObject args = requestArgs(request);
  const QString alias = requiredString(args, QStringLiteral("alias"));
  const QString path = requiredString(args, QStringLiteral("path"));
  const QString note = args.value(QStringLiteral("note")).toString();
  if (alias.isEmpty() || path.isEmpty()) {
    return failure(request, QStringLiteral("invalid_args"), QStringLiteral("memory.remember requires alias and path."));
  }

  QString error;
  if (!memoryStore_.rememberLocation(alias, path, note, &error)) {
    return failure(request, QStringLiteral("memory_error"), error);
  }
  auto memory = memoryStore_.findByAlias(alias, &error);
  if (!memory) return failure(request, QStringLiteral("memory_error"), error.isEmpty() ? QStringLiteral("Location was saved but could not be reloaded.") : error);
  return success(request, locationToJson(*memory));
}

QJsonObject AgentCore::handleForget(const QJsonObject& request) {
  const QString alias = requiredString(requestArgs(request), QStringLiteral("alias"));
  if (alias.isEmpty()) return failure(request, QStringLiteral("invalid_args"), QStringLiteral("memory.forget requires alias."));

  QString error;
  if (!memoryStore_.forgetLocation(alias, &error)) {
    if (error.isEmpty()) error = QStringLiteral("No remembered location uses alias '%1'.").arg(alias);
    return failure(request, QStringLiteral("not_found"), error);
  }
  return success(request, QJsonObject{{QStringLiteral("forgotten"), alias}});
}

QJsonObject AgentCore::handleResolve(const QJsonObject& request) {
  const QString query = requiredString(requestArgs(request), QStringLiteral("query"));
  if (query.isEmpty()) return failure(request, QStringLiteral("invalid_args"), QStringLiteral("memory.resolve requires query."));

  QString error;
  auto located = fileLocator_.resolveBest(query, &error);
  if (!located) {
    return failure(request, QStringLiteral("not_found"), error.isEmpty() ? QStringLiteral("No matching remembered or indexed path was found.") : error);
  }
  return success(request, locatedPathToJson(*located));
}

QJsonObject AgentCore::handleList(const QJsonObject& request) const {
  const int limit = requestArgs(request).value(QStringLiteral("limit")).toInt(100);
  QString error;
  const QList<LocationMemory> memories = memoryStore_.listLocations(limit, &error);
  if (!error.isEmpty()) return failure(request, QStringLiteral("memory_error"), error);

  QJsonArray items;
  for (const LocationMemory& memory : memories) items.push_back(locationToJson(memory));
  return success(request, QJsonObject{{QStringLiteral("locations"), items}});
}

QJsonObject AgentCore::handleAddRoot(const QJsonObject& request) {
  const QJsonObject args = requestArgs(request);
  const QString path = requiredString(args, QStringLiteral("path"));
  const QString label = args.value(QStringLiteral("label")).toString();
  const bool recursive = !args.contains(QStringLiteral("recursive")) || args.value(QStringLiteral("recursive")).toBool(true);
  if (path.isEmpty()) return failure(request, QStringLiteral("invalid_args"), QStringLiteral("memory.add_root requires path."));

  QString error;
  if (!memoryStore_.addSearchRoot(path, label, recursive, &error)) {
    return failure(request, QStringLiteral("memory_error"), error);
  }
  return handleListRoots(request);
}

QJsonObject AgentCore::handleListRoots(const QJsonObject& request) const {
  QString error;
  const QList<SearchRoot> roots = memoryStore_.listSearchRoots(&error);
  if (!error.isEmpty()) return failure(request, QStringLiteral("memory_error"), error);

  QJsonArray items;
  for (const SearchRoot& root : roots) items.push_back(rootToJson(root));
  return success(request, QJsonObject{{QStringLiteral("roots"), items}});
}

QJsonObject AgentCore::handleSearch(const QJsonObject& request) const {
  const QJsonObject args = requestArgs(request);
  const QString query = requiredString(args, QStringLiteral("query"));
  if (query.isEmpty()) return failure(request, QStringLiteral("invalid_args"), QStringLiteral("file.search requires query."));

  const int maxResults = args.value(QStringLiteral("max_results")).toInt(20);
  const int maxScanned = args.value(QStringLiteral("max_scanned_entries")).toInt(10000);
  QString error;
  const QList<LocatedPath> matches = fileLocator_.search(query, maxResults, maxScanned, &error);
  if (!error.isEmpty() && matches.isEmpty()) return failure(request, QStringLiteral("search_error"), error);

  QJsonArray items;
  for (const LocatedPath& match : matches) items.push_back(locatedPathToJson(match));
  return success(request, QJsonObject{{QStringLiteral("matches"), items},
                                      {QStringLiteral("bounded"), true},
                                      {QStringLiteral("max_results"), qMin(qMax(maxResults, 1), 50)}});
}

QJsonObject AgentCore::handleOpen(const QJsonObject& request) {
  const QJsonObject args = requestArgs(request);
  const QString query = requiredString(args, QStringLiteral("query"));
  if (query.isEmpty()) return failure(request, QStringLiteral("invalid_args"), QStringLiteral("file.open requires query."));
  if (!args.value(QStringLiteral("approved")).toBool(false)) {
    return failure(request, QStringLiteral("confirmation_required"),
                   QStringLiteral("Opening a local file or directory requires explicit user approval."), true);
  }

  QString error;
  auto located = fileLocator_.resolveBest(query, &error);
  if (!located) {
    return failure(request, QStringLiteral("not_found"), error.isEmpty() ? QStringLiteral("Target could not be resolved.") : error);
  }
  if (!fileLocator_.isAllowedPath(located->path, &error)) {
    return failure(request, QStringLiteral("path_not_allowed"), error);
  }
  if (!QDesktopServices::openUrl(QUrl::fromLocalFile(located->path))) {
    return failure(request, QStringLiteral("open_failed"), QStringLiteral("The operating system could not open the target."));
  }
  return success(request, locatedPathToJson(*located));
}
