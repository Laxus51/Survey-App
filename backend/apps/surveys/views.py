from rest_framework import generics
from rest_framework.parsers import FormParser, MultiPartParser

from .models import Survey
from .pagination import SurveyPagination
from .serializers import SurveySerializer
from .services import soft_delete_survey


class SurveyListCreateView(generics.ListCreateAPIView):
    serializer_class = SurveySerializer
    parser_classes = [MultiPartParser, FormParser]
    pagination_class = SurveyPagination

    def get_queryset(self):
        return Survey.objects.filter(user=self.request.user, is_deleted=False)


class SurveyDetailView(generics.RetrieveUpdateDestroyAPIView):
    serializer_class = SurveySerializer
    parser_classes = [MultiPartParser, FormParser]

    def get_queryset(self):
        # Scoping by owner here means a non-owner requesting another user's
        # survey id gets a plain 404, not a 403 that would leak the id's
        # existence.
        return Survey.objects.filter(user=self.request.user, is_deleted=False)

    def perform_destroy(self, instance):
        soft_delete_survey(instance)
