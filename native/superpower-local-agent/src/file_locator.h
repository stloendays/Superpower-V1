#pragma once

#include <QList>
#include <QString>

#include "memory_store.h"

struct LocatedPath {
  QString path;
  QString displayName;
  QString source;
  QString alias;
  bool isDirectory = false;
};

class FileLocator {
 public:
  explicit FileLocator(MemoryStore& memoryStore);

  std::optional<LocatedPath> resolveBest(const QString& query, QString* error = nullptr);
  QList<LocatedPath> search(const QString& query, int maxResults = 20, int maxScannedEntries = 10000,
                            QString* error = nullptr) const;
  bool isAllowedPath(const QString& path, QString* error = nullptr) const;

 private:
  static QString normalizedExistingPath(const QString& path);
  static bool pathIsInside(const QString& candidate, const QString& root);

  MemoryStore& memoryStore_;
};
